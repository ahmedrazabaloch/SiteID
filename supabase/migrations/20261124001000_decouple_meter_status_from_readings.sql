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
  v_source_previous_reading numeric(14,2);
  v_source_previous_total numeric(12,2);
  v_source_previous_date date;
  v_previous_reading numeric(14,2);
  v_previous_total numeric(12,2);
  v_previous_date date;
  v_status text;
  v_old public.site_latest%rowtype;
  v_old_exists boolean;
  v_consumed numeric(12,2);
  v_hours numeric(14,2);
  v_average numeric(14,4);
  v_avg_status text;
  v_baseline_valid boolean;
  v_elapsed_hours numeric(14,2);
  v_count integer := 0;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;

  for v_item in select value from jsonb_array_elements(p_rows)
  loop
    v_id := nullif(trim(v_item ->> 'site_id'), '');
    v_date := nullif(v_item ->> 'fueling_date', '')::date;
    v_available := nullif(v_item ->> 'available_fuel', '')::numeric;
    v_poured := nullif(v_item ->> 'fuel_poured', '')::numeric;
    v_reading := nullif(v_item ->> 'current_reading', '')::numeric;
    v_source_previous_reading := nullif(v_item ->> 'source_previous_reading', '')::numeric;
    v_source_previous_total := nullif(v_item ->> 'source_previous_total_fuel', '')::numeric;
    v_source_previous_date := nullif(v_item ->> 'source_previous_fueling_date', '')::date;

    if v_id is null or v_date is null or v_available is null or v_poured is null then
      raise exception 'Daily row is missing a required value';
    end if;
    if v_available < 0 or v_poured < 0 then raise exception 'Fuel amounts cannot be negative'; end if;
    if not exists (select 1 from public.site_master where site_id = v_id) then
      raise exception 'Site ID % is not in Master Sites', v_id;
    end if;

    select * into v_old from public.site_latest where site_id = v_id;
    v_old_exists := found;
    if v_old_exists and v_date < v_old.fueling_date then continue; end if;

    select dg_meter_status into v_status from public.site_master where site_id = v_id;
    v_status := lower(coalesce(nullif(trim(v_item ->> 'dg_meter_status'), ''), v_status, 'unknown'));
    if v_status not in ('working','faulty','replaced','missing','suspected','unknown') then v_status := 'unknown'; end if;

    if v_old_exists and v_date > v_old.fueling_date then
      if v_source_previous_date is not null and v_source_previous_date > v_old.fueling_date then
        v_previous_total := coalesce(v_source_previous_total, v_old.total_fuel);
        v_previous_reading := coalesce(v_source_previous_reading, v_old.current_reading);
        v_previous_date := v_source_previous_date;
      else
        v_previous_total := v_old.total_fuel;
        v_previous_reading := v_old.current_reading;
        v_previous_date := v_old.fueling_date;
      end if;
    elsif v_old_exists then
      v_previous_total := coalesce(v_source_previous_total, v_old.previous_total_fuel);
      v_previous_reading := coalesce(v_source_previous_reading, v_old.previous_reading);
      v_previous_date := coalesce(v_source_previous_date, v_old.fueling_date);
    else
      v_previous_total := v_source_previous_total;
      v_previous_reading := v_source_previous_reading;
      v_previous_date := v_source_previous_date;
    end if;
    v_consumed := case when v_previous_total is not null then v_previous_total - v_available else null end;
    v_hours := null;
    v_average := null;
    v_avg_status := 'n_a';
    v_baseline_valid := (v_status not in ('faulty', 'missing') and v_reading is not null);

    if v_status not in ('faulty', 'missing') and v_reading is not null and v_previous_reading is not null then
      v_hours := v_reading - v_previous_reading;
      v_elapsed_hours := greatest(0, (v_date - coalesce(v_previous_date, v_date))::numeric * 24);
      if v_hours < 0 or (v_elapsed_hours > 0 and v_hours > v_elapsed_hours) then
        v_hours := null;
        v_avg_status := 'check';
        v_baseline_valid := false;
      elsif v_consumed < 0 then
        v_avg_status := 'check';
        v_baseline_valid := false;
      elsif v_hours > 0 and v_consumed is not null then
        v_average := v_consumed / v_hours;
        v_avg_status := 'valid';
      elsif v_source_previous_reading is null and not v_old_exists then
        v_avg_status := 'baseline';
      end if;
    elsif v_status not in ('faulty', 'missing') and v_reading is not null and v_source_previous_reading is null and not v_old_exists then
      v_avg_status := 'baseline';
    end if;

    insert into public.site_latest (
      site_id, fueling_date, available_fuel, fuel_poured, previous_total_fuel,
      fuel_consumed_since_last, dg_meter_status, previous_reading, current_reading,
      running_hours, average_consumption, average_status, baseline_valid, last_imported_by, updated_at
    ) values (
      v_id, v_date, v_available, v_poured, v_previous_total,
      case when v_consumed >= 0 then v_consumed else null end, v_status, v_previous_reading, v_reading,
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

update public.site_latest
set
  running_hours = current_reading - previous_reading,
  average_consumption = case
    when (current_reading - previous_reading) > 0 and fuel_consumed_since_last is not null and fuel_consumed_since_last >= 0
    then fuel_consumed_since_last / (current_reading - previous_reading)
    when (current_reading - previous_reading) > 0 and previous_total_fuel is not null and available_fuel is not null and (previous_total_fuel - available_fuel) >= 0
    then (previous_total_fuel - available_fuel) / (current_reading - previous_reading)
    else average_consumption
  end,
  average_status = case
    when (current_reading - previous_reading) > 0 and (
      (fuel_consumed_since_last is not null and fuel_consumed_since_last >= 0) or
      (previous_total_fuel is not null and available_fuel is not null and (previous_total_fuel - available_fuel) >= 0)
    ) then 'valid'
    else average_status
  end,
  baseline_valid = true
where running_hours is null
  and current_reading is not null
  and previous_reading is not null
  and current_reading >= previous_reading
  and dg_meter_status not in ('faulty', 'missing');
