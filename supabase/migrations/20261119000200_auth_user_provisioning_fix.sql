-- Supabase Auth inserts the initial provider metadata before custom app_metadata
-- is applied, so an auth.users BEFORE INSERT trigger cannot authorize that flag.
-- New profiles are therefore inactive by default and are activated only by the
-- protected super-admin route after it has assigned the login ID and role.
drop trigger if exists require_super_admin_provisioning on auth.users;
alter table public.profiles alter column is_active set default false;
