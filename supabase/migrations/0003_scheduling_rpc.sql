-- PrintFlow - 0003: programmazione transazionale con controllo conflitti e intervallo minimo.
-- security invoker: la RLS resta attiva. Blocco per stampante => due dispositivi non possono salvare in parallelo.
create or replace function schedule_job(p_job_id uuid, p_start timestamptz, p_expected_version int default null)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  j print_jobs; v_gap interval; v_dur interval; v_end timestamptz;
  v_start timestamptz := p_start; v_blk timestamptz; v_i int := 0; v_conf jsonb; v_row print_jobs;
begin
  select * into j from print_jobs where id = p_job_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if p_expected_version is not null and j.version <> p_expected_version then
    return jsonb_build_object('ok', false, 'error', 'version_conflict', 'current_version', j.version);
  end if;
  if j.status in ('completed','cancelled') then
    return jsonb_build_object('ok', false, 'error', 'invalid_status');
  end if;

  perform 1 from printers where id = j.printer_id for update;  -- serializza per stampante
  select make_interval(mins => changeover_minutes) into v_gap from user_settings where user_id = j.user_id;
  v_gap := coalesce(v_gap, interval '15 minutes');
  v_dur := make_interval(mins => j.duration_minutes);
  v_end := p_start + v_dur;

  select coalesce(jsonb_agg(jsonb_build_object(
           'job_id', o.id, 'name', o.name, 'planned_start', o.planned_start, 'planned_end', o.planned_end,
           'reason', case when o.planned_start < v_end and o.planned_end > p_start then 'overlap' else 'min_gap' end)), '[]'::jsonb)
    into v_conf
    from print_jobs o
   where o.printer_id = j.printer_id and o.id <> j.id and o.status <> 'cancelled' and o.planned_start is not null
     and o.planned_start < v_end + v_gap and o.planned_end + v_gap > p_start;

  if jsonb_array_length(v_conf) > 0 then
    loop  -- primo orario compatibile dopo quello richiesto
      v_i := v_i + 1; exit when v_i > 200;
      select max(o.planned_end) into v_blk from print_jobs o
       where o.printer_id = j.printer_id and o.id <> j.id and o.status <> 'cancelled' and o.planned_start is not null
         and o.planned_start < v_start + v_dur + v_gap and o.planned_end + v_gap > v_start;
      exit when v_blk is null;
      v_start := v_blk + v_gap;
    end loop;
    return jsonb_build_object('ok', false, 'error', 'conflict', 'conflicts', v_conf, 'suggested_start', v_start);
  end if;

  update print_jobs
     set planned_start = p_start,
         status = case when status = 'to_schedule' then 'scheduled'::job_status else status end
   where id = j.id returning * into v_row;
  return jsonb_build_object('ok', true, 'job', to_jsonb(v_row));
end $$;
grant execute on function schedule_job(uuid, timestamptz, int) to authenticated;
