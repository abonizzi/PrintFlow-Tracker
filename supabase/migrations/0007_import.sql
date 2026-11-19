-- Fase 7a: importazione transazionale. Tutto o niente: qualunque errore annulla l'intera importazione.
create table import_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null, filename text,
  inserted int not null default 0, updated int not null default 0, skipped int not null default 0, demoted int not null default 0,
  created_at timestamptz not null default now()
);
create index on import_batches(user_id, created_at desc);
alter table import_batches enable row level security;
create policy import_batches_select on import_batches for select to authenticated using (user_id = (select auth.uid()));
create policy import_batches_insert on import_batches for insert to authenticated with check (user_id = (select auth.uid()));
create policy import_batches_delete on import_batches for delete to authenticated using (user_id = (select auth.uid()));

create or replace function import_jobs(p_source text, p_rows jsonb, p_batch jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_printer uuid; v_gap interval; r jsonb;
  v_start timestamptz; v_end timestamptz; v_dur int; v_status job_status; v_tid uuid; v_ext text;
  v_touched uuid[] := '{}'; n_ins int := 0; n_upd int := 0;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select id into v_printer from printers where user_id = v_uid and is_default limit 1 for update;  -- serializza con schedule_job
  if v_printer is null then raise exception 'no_default_printer'; end if;
  select make_interval(mins => changeover_minutes) into v_gap from user_settings where user_id = v_uid;
  v_gap := coalesce(v_gap, interval '15 minutes');

  for r in select value from jsonb_array_elements(p_rows) loop
    v_start := nullif(r->>'planned_start', '')::timestamptz;
    v_dur := (r->>'duration_minutes')::int;
    v_status := (r->>'status')::job_status;
    v_ext := nullif(r->>'external_id', '');
    if v_start is not null and v_status <> 'cancelled' then
      v_end := v_start + make_interval(mins => v_dur);
      if exists (select 1 from print_jobs o
                  where o.printer_id = v_printer and o.status <> 'cancelled' and o.planned_start is not null
                    and o.id is distinct from nullif(r->>'id', '')::uuid
                    and o.planned_start < v_end + v_gap and o.planned_end + v_gap > v_start) then
        raise exception 'conflict: %', r->>'name';
      end if;
    end if;

    if r->>'action' = 'update' then
      update print_jobs set name = r->>'name', pieces_per_plate = (r->>'pieces_per_plate')::int, duration_minutes = v_dur,
             priority = (r->>'priority')::job_priority, status = v_status, optional = coalesce((r->>'optional')::boolean, false),
             planned_start = v_start, notes = r->>'notes', import_meta = r->'import_meta',
             actual_start = coalesce(nullif(r->>'actual_start', '')::timestamptz, actual_start),
             actual_end = coalesce(nullif(r->>'actual_end', '')::timestamptz, actual_end)
       where id = (r->>'id')::uuid;
      if not found then raise exception 'not_found: %', coalesce(v_ext, r->>'name'); end if;
      n_upd := n_upd + 1;
    else
      select id into v_tid from print_templates
       where user_id = v_uid and archived_at is null and lower(name) = lower(r->>'name')
         and pieces_per_plate = (r->>'pieces_per_plate')::int and duration_minutes = v_dur limit 1;
      if v_tid is null then
        insert into print_templates(user_id, name, pieces_per_plate, duration_minutes, repetitions, priority, color, divisible)
        values (v_uid, r->>'name', (r->>'pieces_per_plate')::int, v_dur, 1, (r->>'priority')::job_priority,
                coalesce(r->>'color', '#3b82f6'), coalesce((r->>'divisible')::boolean, false)) returning id into v_tid;
      end if;
      v_touched := v_touched || v_tid;
      insert into print_jobs(user_id, printer_id, template_id, repetition_index, name, pieces_per_plate, duration_minutes, priority, status,
                             optional, planned_start, actual_start, actual_end, external_id, import_source, import_meta, notes)
      values (v_uid, v_printer, v_tid,
              coalesce((select max(repetition_index) from print_jobs where template_id = v_tid), 0) + 1,
              r->>'name', (r->>'pieces_per_plate')::int, v_dur, (r->>'priority')::job_priority, v_status,
              coalesce((r->>'optional')::boolean, false), v_start,
              nullif(r->>'actual_start', '')::timestamptz, nullif(r->>'actual_end', '')::timestamptz,
              v_ext, case when v_ext is null then null else p_source end, r->'import_meta', r->>'notes');
      n_ins := n_ins + 1;
    end if;
  end loop;

  update print_templates t set repetitions = greatest(t.repetitions, c.n)
    from (select template_id, count(*)::int n from print_jobs where template_id = any(v_touched) group by template_id) c
   where t.id = c.template_id;
  insert into import_batches(user_id, source, filename, inserted, updated, skipped, demoted)
  values (v_uid, p_source, p_batch->>'filename', n_ins, n_upd, coalesce((p_batch->>'skipped')::int, 0), coalesce((p_batch->>'demoted')::int, 0));
  return jsonb_build_object('inserted', n_ins, 'updated', n_upd);
end $$;
grant execute on function import_jobs(text, jsonb, jsonb) to authenticated;
