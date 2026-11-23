alter table public.site_master
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists location_source text,
  add column if not exists location_updated_at timestamptz;

alter table public.site_master
  drop constraint if exists site_master_latitude_range,
  drop constraint if exists site_master_longitude_range,
  drop constraint if exists site_master_location_pair,
  add constraint site_master_latitude_range check (latitude is null or latitude between -90 and 90),
  add constraint site_master_longitude_range check (longitude is null or longitude between -180 and 180),
  add constraint site_master_location_pair check ((latitude is null) = (longitude is null));
