create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  role text not null default 'operator' check (role in ('admin', 'operator')),
  operator_shift text not null default 'day' check (operator_shift in ('day', 'evening', 'night')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create table if not exists public.site_master (
  site_id text primary key,
  address text not null default '',
  site_area text not null default '',
  day_team text not null default '',
  day_route text not null default '',
  day_fueler text not null default '',
  day_driver text not null default '',
  night_team text not null default '',
  night_route text not null default '',
  night_fueler text not null default '',
  night_driver text not null default '',
  cluster_owner_name text not null default '',
  cluster_owner_phone text not null default '',
  night_on_caller_name text not null default '',
  night_on_caller_phone text not null default '',
  ie_lead_name text not null default '',
  ie_lead_phone text not null default '',
  zong_lead_name text not null default '',
  zong_lead_phone text not null default '',
  security_company text not null default '',
  security_so_name text not null default '',
  security_so_phone text not null default '',
  access_notes text not null default '',
  dg_brand text not null default '',
  dg_serial_number text not null default '',
  dg_meter_status text not null default 'unknown' check (dg_meter_status in ('working','faulty','replaced','missing','suspected','unknown')),
  site_status text not null default '',
  other_notes text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

create table if not exists public.site_latest (
  site_id text primary key references public.site_master(site_id) on delete cascade,
  fueling_date date not null,
  available_fuel numeric(12,2) not null check (available_fuel >= 0),
  fuel_poured numeric(12,2) not null check (fuel_poured >= 0),
  total_fuel numeric(12,2) generated always as (available_fuel + fuel_poured) stored,
  previous_total_fuel numeric(12,2),
  fuel_consumed_since_last numeric(12,2),
  dg_meter_status text not null default 'unknown',
  previous_reading numeric(14,2),
  current_reading numeric(14,2),
  running_hours numeric(14,2),
  average_consumption numeric(14,4),
  average_status text not null default 'n_a' check (average_status in ('valid','baseline','n_a','check')),
  baseline_valid boolean not null default false,
  last_imported_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.route_vehicles (
  route text not null,
  field_shift text not null check (field_shift in ('day','night')),
  team text not null default '',
  vehicle_number text not null default '',
  driver text not null default '',
  fueler_supervisor text not null default '',
  notes text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  primary key (route, field_shift)
);

create table if not exists public.import_runs (
  id bigint generated always as identity primary key,
  import_type text not null check (import_type in ('master','daily')),
  file_name text not null,
  imported_rows integer not null default 0,
  imported_by uuid references auth.users(id),
  imported_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.site_master enable row level security;
alter table public.site_latest enable row level security;
alter table public.route_vehicles enable row level security;
alter table public.import_runs enable row level security;

drop policy if exists "profiles self read" on public.profiles;
create policy "profiles self read" on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
drop policy if exists "profiles admin update" on public.profiles;
create policy "profiles admin update" on public.profiles for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "sites read for signed in" on public.site_master;
create policy "sites read for signed in" on public.site_master for select to authenticated using (true);
drop policy if exists "sites admin write" on public.site_master;
create policy "sites admin write" on public.site_master for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "latest read for signed in" on public.site_latest;
create policy "latest read for signed in" on public.site_latest for select to authenticated using (true);
drop policy if exists "latest admin write" on public.site_latest;
create policy "latest admin write" on public.site_latest for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "vehicles read for signed in" on public.route_vehicles;
create policy "vehicles read for signed in" on public.route_vehicles for select to authenticated using (true);
drop policy if exists "vehicles admin write" on public.route_vehicles;
create policy "vehicles admin write" on public.route_vehicles for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "imports admin read" on public.import_runs;
create policy "imports admin read" on public.import_runs for select to authenticated using (public.is_admin());
drop policy if exists "imports admin insert" on public.import_runs;
create policy "imports admin insert" on public.import_runs for insert to authenticated with check (public.is_admin());

create or replace function public.apply_daily_import(p_rows jsonb, p_file_name text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_item jsonb;
  v_id text;
  v_date date;
  v_available numeric(12,2);
  v_poured numeric(12,2);
  v_reading numeric(14,2);
  v_status text;
  v_old public.site_latest%rowtype;
  v_old_exists boolean;
  v_previous_total numeric(12,2);
  v_consumed numeric(12,2);
  v_hours numeric(14,2);
  v_average numeric(14,4);
  v_avg_status text;
  v_baseline_valid boolean;
  v_elapsed_hours numeric(14,2);
  v_count integer := 0;
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  for v_item in select value from jsonb_array_elements(p_rows)
  loop
    v_id := nullif(trim(v_item ->> 'site_id'), '');
    v_date := nullif(v_item ->> 'fueling_date', '')::date;
    v_available := nullif(v_item ->> 'available_fuel', '')::numeric;
    v_poured := nullif(v_item ->> 'fuel_poured', '')::numeric;
    v_reading := nullif(v_item ->> 'current_reading', '')::numeric;

    if v_id is null or v_date is null or v_available is null or v_poured is null then
      raise exception 'Daily row is missing a required value';
    end if;
    if not exists (select 1 from public.site_master where site_id = v_id) then
      raise exception 'Site ID % is not in Master Sites', v_id;
    end if;

    select * into v_old from public.site_latest where site_id = v_id;
    v_old_exists := found;
    select dg_meter_status into v_status from public.site_master where site_id = v_id;
    v_status := lower(coalesce(nullif(trim(v_item ->> 'dg_meter_status'), ''), v_status, 'unknown'));
    if v_status not in ('working','faulty','replaced','missing','suspected','unknown') then v_status := 'unknown'; end if;
    v_previous_total := case when v_old_exists then v_old.total_fuel else null end;
    v_consumed := case when v_old_exists then v_old.total_fuel - v_available else null end;
    v_hours := null;
    v_average := null;
    v_avg_status := 'n_a';
    v_baseline_valid := (v_status = 'working' and v_reading is not null);

    if v_old_exists and v_status = 'working' and v_old.dg_meter_status = 'working'
       and v_old.baseline_valid and v_reading is not null and v_old.current_reading is not null then
      v_hours := v_reading - v_old.current_reading;
      v_elapsed_hours := greatest(0, (v_date - v_old.fueling_date)::numeric * 24);
      if v_hours < 0 or (v_elapsed_hours > 0 and v_hours > v_elapsed_hours) then
        v_hours := null;
        v_avg_status := 'check';
        v_baseline_valid := false;
      elsif v_hours > 0 and v_consumed >= 0 then
        v_average := v_consumed / v_hours;
        v_avg_status := 'valid';
      else
        v_avg_status := 'n_a';
      end if;
    elsif v_status = 'working' and v_reading is not null then
      v_avg_status := 'baseline';
    end if;

    insert into public.site_latest (
      site_id, fueling_date, available_fuel, fuel_poured, previous_total_fuel,
      fuel_consumed_since_last, dg_meter_status, previous_reading, current_reading,
      running_hours, average_consumption, average_status, baseline_valid, last_imported_by, updated_at
    ) values (
      v_id, v_date, v_available, v_poured, v_previous_total,
      case when v_consumed >= 0 then v_consumed else null end, v_status,
      case when v_old_exists then v_old.current_reading else null end, v_reading,
      v_hours, v_average, v_avg_status, v_baseline_valid, auth.uid(), now()
    )
    on conflict (site_id) do update set
      fueling_date = excluded.fueling_date,
      available_fuel = excluded.available_fuel,
      fuel_poured = excluded.fuel_poured,
      previous_total_fuel = excluded.previous_total_fuel,
      fuel_consumed_since_last = excluded.fuel_consumed_since_last,
      dg_meter_status = excluded.dg_meter_status,
      previous_reading = excluded.previous_reading,
      current_reading = excluded.current_reading,
      running_hours = excluded.running_hours,
      average_consumption = excluded.average_consumption,
      average_status = excluded.average_status,
      baseline_valid = excluded.baseline_valid,
      last_imported_by = excluded.last_imported_by,
      updated_at = excluded.updated_at;
    v_count := v_count + 1;
  end loop;

  insert into public.import_runs (import_type, file_name, imported_rows, imported_by)
  values ('daily', coalesce(p_file_name, 'daily-update.xlsx'), v_count, auth.uid());

  return jsonb_build_object('imported', v_count);
end;
$$;

grant execute on function public.apply_daily_import(jsonb, text) to authenticated;
create or replace function public.apply_master_import(p_rows jsonb, p_file_name text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_item jsonb;
  v_id text;
  v_count integer := 0;
  v_status text;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  for v_item in select value from jsonb_array_elements(p_rows)
  loop
    v_id := nullif(trim(v_item ->> 'site_id'), '');
    if v_id is null then raise exception 'Master row has no Site ID'; end if;
    v_status := lower(coalesce(nullif(trim(v_item ->> 'dg_meter_status'), ''), 'unknown'));
    if v_status not in ('working','faulty','replaced','missing','suspected','unknown') then v_status := 'unknown'; end if;

    insert into public.site_master (
      site_id,address,site_area,day_team,day_route,day_fueler,day_driver,
      night_team,night_route,night_fueler,night_driver,cluster_owner_name,cluster_owner_phone,
      night_on_caller_name,night_on_caller_phone,ie_lead_name,ie_lead_phone,zong_lead_name,zong_lead_phone,
      security_company,security_so_name,security_so_phone,access_notes,dg_brand,dg_serial_number,
      dg_meter_status,site_status,other_notes,updated_at,updated_by
    ) values (
      v_id,coalesce(v_item->>'address',''),coalesce(v_item->>'site_area',''),
      coalesce(v_item->>'day_team',''),coalesce(v_item->>'day_route',''),coalesce(v_item->>'day_fueler',''),coalesce(v_item->>'day_driver',''),
      coalesce(v_item->>'night_team',''),coalesce(v_item->>'night_route',''),coalesce(v_item->>'night_fueler',''),coalesce(v_item->>'night_driver',''),
      coalesce(v_item->>'cluster_owner_name',''),coalesce(v_item->>'cluster_owner_phone',''),
      coalesce(v_item->>'night_on_caller_name',''),coalesce(v_item->>'night_on_caller_phone',''),
      coalesce(v_item->>'ie_lead_name',''),coalesce(v_item->>'ie_lead_phone',''),coalesce(v_item->>'zong_lead_name',''),coalesce(v_item->>'zong_lead_phone',''),
      coalesce(v_item->>'security_company',''),coalesce(v_item->>'security_so_name',''),coalesce(v_item->>'security_so_phone',''),
      coalesce(v_item->>'access_notes',''),coalesce(v_item->>'dg_brand',''),coalesce(v_item->>'dg_serial_number',''),
      v_status,coalesce(v_item->>'site_status',''),coalesce(v_item->>'other_notes',''),now(),auth.uid()
    )
    on conflict (site_id) do update set
      address=coalesce(nullif(excluded.address,''),site_master.address),
      site_area=coalesce(nullif(excluded.site_area,''),site_master.site_area),
      day_team=coalesce(nullif(excluded.day_team,''),site_master.day_team),
      day_route=coalesce(nullif(excluded.day_route,''),site_master.day_route),
      day_fueler=coalesce(nullif(excluded.day_fueler,''),site_master.day_fueler),
      day_driver=coalesce(nullif(excluded.day_driver,''),site_master.day_driver),
      night_team=coalesce(nullif(excluded.night_team,''),site_master.night_team),
      night_route=coalesce(nullif(excluded.night_route,''),site_master.night_route),
      night_fueler=coalesce(nullif(excluded.night_fueler,''),site_master.night_fueler),
      night_driver=coalesce(nullif(excluded.night_driver,''),site_master.night_driver),
      cluster_owner_name=coalesce(nullif(excluded.cluster_owner_name,''),site_master.cluster_owner_name),
      cluster_owner_phone=coalesce(nullif(excluded.cluster_owner_phone,''),site_master.cluster_owner_phone),
      night_on_caller_name=coalesce(nullif(excluded.night_on_caller_name,''),site_master.night_on_caller_name),
      night_on_caller_phone=coalesce(nullif(excluded.night_on_caller_phone,''),site_master.night_on_caller_phone),
      ie_lead_name=coalesce(nullif(excluded.ie_lead_name,''),site_master.ie_lead_name),
      ie_lead_phone=coalesce(nullif(excluded.ie_lead_phone,''),site_master.ie_lead_phone),
      zong_lead_name=coalesce(nullif(excluded.zong_lead_name,''),site_master.zong_lead_name),
      zong_lead_phone=coalesce(nullif(excluded.zong_lead_phone,''),site_master.zong_lead_phone),
      security_company=coalesce(nullif(excluded.security_company,''),site_master.security_company),
      security_so_name=coalesce(nullif(excluded.security_so_name,''),site_master.security_so_name),
      security_so_phone=coalesce(nullif(excluded.security_so_phone,''),site_master.security_so_phone),
      access_notes=coalesce(nullif(excluded.access_notes,''),site_master.access_notes),
      dg_brand=coalesce(nullif(excluded.dg_brand,''),site_master.dg_brand),
      dg_serial_number=coalesce(nullif(excluded.dg_serial_number,''),site_master.dg_serial_number),
      dg_meter_status=case when v_item ? 'dg_meter_status' and coalesce(v_item->>'dg_meter_status','') <> '' then v_status else site_master.dg_meter_status end,
      site_status=coalesce(nullif(excluded.site_status,''),site_master.site_status),
      other_notes=coalesce(nullif(excluded.other_notes,''),site_master.other_notes),
      updated_at=now(), updated_by=auth.uid();
    v_count := v_count + 1;
  end loop;
  insert into public.import_runs (import_type,file_name,imported_rows,imported_by)
  values ('master',coalesce(p_file_name,'master-sites.xlsx'),v_count,auth.uid());
  return jsonb_build_object('imported',v_count);
end;
$$;
grant execute on function public.apply_master_import(jsonb, text) to authenticated;
