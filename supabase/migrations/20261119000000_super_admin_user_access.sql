alter table public.profiles
  add column if not exists username text,
  add column if not exists is_active boolean not null default true;

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('super_admin', 'admin', 'operator'));
create unique index if not exists profiles_username_unique on public.profiles (username) where username is not null;

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and is_active);
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and is_active and role = 'super_admin');
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and is_active and role in ('admin', 'super_admin'));
$$;

create or replace function public.protect_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_super_admin() then
    if new.role is distinct from old.role
      or new.username is distinct from old.username
      or new.is_active is distinct from old.is_active then
      raise exception 'Only the super admin can change account role, login ID, or active status';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profile_privileges on public.profiles;
create trigger protect_profile_privileges
before update on public.profiles
for each row execute function public.protect_profile_privileges();

create or replace function public.require_super_admin_provisioning()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.raw_app_meta_data ->> 'fuel_ops_provisioned', '') <> 'super_admin' then
    raise exception 'Fuel Ops accounts must be created by the super admin';
  end if;
  return new;
end;
$$;

drop trigger if exists require_super_admin_provisioning on auth.users;
create trigger require_super_admin_provisioning
before insert on auth.users
for each row execute function public.require_super_admin_provisioning();

drop policy if exists "profiles self read" on public.profiles;
create policy "profiles self read" on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
drop policy if exists "profiles admin update" on public.profiles;
create policy "profiles admin update" on public.profiles for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "sites read for signed in" on public.site_master;
create policy "sites read for signed in" on public.site_master for select to authenticated using (public.is_active_user());
drop policy if exists "latest read for signed in" on public.site_latest;
create policy "latest read for signed in" on public.site_latest for select to authenticated using (public.is_active_user());
drop policy if exists "vehicles read for signed in" on public.route_vehicles;
create policy "vehicles read for signed in" on public.route_vehicles for select to authenticated using (public.is_active_user());

do $$
declare
  v_super_admin_id uuid;
  v_admin_count integer;
begin
  select count(*), (array_agg(id order by created_at))[1]
  into v_admin_count, v_super_admin_id
  from public.profiles
  where role = 'admin';

  if v_admin_count <> 1 or v_super_admin_id is null then
    raise exception 'Expected exactly one existing admin profile to promote to super admin; found %', v_admin_count;
  end if;

  update public.profiles
  set role = 'super_admin', is_active = true, updated_at = now()
  where id = v_super_admin_id;

  if not found then
    raise exception 'The existing admin profile could not be promoted to super admin';
  end if;
end;
$$;

create or replace function public.update_my_profile(p_full_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if not public.is_active_user() then raise exception 'This account is inactive'; end if;
  if nullif(trim(p_full_name), '') is null then raise exception 'Name cannot be empty'; end if;

  update public.profiles
  set full_name = trim(p_full_name), updated_at = now()
  where id = auth.uid();
end;
$$;

revoke all on function public.update_my_profile(text) from public;
grant execute on function public.update_my_profile(text) to authenticated;
