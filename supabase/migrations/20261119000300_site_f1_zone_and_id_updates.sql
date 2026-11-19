alter table public.site_master
  add column if not exists f1_zone text not null default '';

alter table public.site_latest
  drop constraint if exists site_latest_site_id_fkey;
alter table public.site_latest
  add constraint site_latest_site_id_fkey
  foreign key (site_id) references public.site_master(site_id)
  on update cascade on delete cascade;

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
      site_id,address,site_area,f1_zone,day_team,day_route,day_fueler,day_driver,
      night_team,night_route,night_fueler,night_driver,cluster_owner_name,cluster_owner_phone,
      night_on_caller_name,night_on_caller_phone,ie_lead_name,ie_lead_phone,zong_lead_name,zong_lead_phone,
      security_company,security_so_name,security_so_phone,access_notes,dg_brand,dg_serial_number,
      dg_meter_status,site_status,other_notes,updated_at,updated_by
    ) values (
      v_id,coalesce(v_item->>'address',''),coalesce(v_item->>'site_area',''),coalesce(v_item->>'f1_zone',''),
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
      f1_zone=coalesce(nullif(excluded.f1_zone,''),site_master.f1_zone),
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
