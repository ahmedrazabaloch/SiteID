create or replace function public.update_my_profile(p_full_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;
  if nullif(trim(p_full_name), '') is null then
    raise exception 'Name cannot be empty';
  end if;

  update public.profiles
  set full_name = trim(p_full_name), updated_at = now()
  where id = auth.uid();
end;
$$;

revoke all on function public.update_my_profile(text) from public;
grant execute on function public.update_my_profile(text) to authenticated;
