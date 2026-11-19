-- ==============================================================================
-- PrintFlow - SETUP COMPLETO DEL DATABASE (migrazioni 0001-0007 in un unico file)
-- Esegui UNA SOLA VOLTA su un progetto Supabase nuovo: SQL Editor > New query > incolla > Run.
-- (Rieseguirlo darebbe errori 'already exists'.) Poi, se vuoi: supabase/tests/isolamento_e_conflitti.sql
-- ==============================================================================

-- ########## 0001_schema.sql ##########
-- PrintFlow - 0001: schema base
create extension if not exists btree_gist;

create type job_priority as enum ('max','high','medium','low');
create type job_status as enum ('to_schedule','scheduled','in_progress','completed','cancelled');

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create table user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  timezone text not null default 'Europe/Rome',
  changeover_minutes int not null default 15 check (changeover_minutes between 0 and 240),
  snap_minutes int not null default 15 check (snap_minutes in (1,5,10,15)),
  theme text not null default 'system' check (theme in ('light','dark','system')),
  updated_at timestamptz not null default now()
);

create table printers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Stampante 1',
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (id, user_id)
);
create unique index one_default_printer on printers(user_id) where is_default;

create table print_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  description text,
  pieces_per_plate int not null default 1 check (pieces_per_plate > 0),
  duration_minutes int not null check (duration_minutes > 0),
  repetitions int not null default 1 check (repetitions > 0),
  priority job_priority not null default 'medium',
  color text not null default '#3b82f6' check (color ~ '^#[0-9a-fA-F]{6}$'),
  notes text,
  divisible boolean not null default false,
  preview_url text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, user_id)
);
create index on print_templates(user_id, archived_at);

create table print_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  printer_id uuid not null,
  template_id uuid,
  repetition_index int check (repetition_index > 0),
  name text not null,
  pieces_per_plate int not null default 1 check (pieces_per_plate > 0),
  duration_minutes int not null check (duration_minutes > 0),
  priority job_priority not null default 'medium',
  status job_status not null default 'to_schedule',
  optional boolean not null default false,
  planned_start timestamptz,
  planned_end timestamptz,            -- calcolata dal trigger: start + durata
  actual_start timestamptz,
  actual_end timestamptz,
  external_id text,
  import_source text,
  import_meta jsonb,
  notes text,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (printer_id, user_id) references printers(id, user_id),
  foreign key (template_id, user_id) references print_templates(id, user_id),
  constraint end_after_start check (planned_end is null or planned_end > planned_start),
  constraint start_end_together check ((planned_start is null) = (planned_end is null)),
  constraint active_needs_time check (status not in ('scheduled','in_progress') or planned_start is not null),
  constraint actual_order check (actual_end is null or actual_start is null or actual_end > actual_start),
  constraint ext_pair check ((external_id is null) = (import_source is null)),
  -- rete di sicurezza: nessuna sovrapposizione sulla stessa stampante
  constraint no_overlap exclude using gist (
    printer_id with =,
    tstzrange(planned_start, planned_end, '[)') with &&
  ) where (planned_start is not null and status <> 'cancelled')
);
create index on print_jobs(user_id, planned_start);
create index on print_jobs(user_id, status);
create index on print_jobs(template_id);
create unique index print_jobs_dedup on print_jobs(user_id, import_source, external_id) where external_id is not null;

create table availability_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6), -- 0 = lunedì
  wake_time time not null default '05:30',
  leave_time time default '07:15',
  return_time time default '17:30',
  last_evening_start time not null default '21:30',
  change_windows jsonb not null default '[]',
  unique (user_id, weekday)
);

create table availability_exceptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  on_date date not null,
  kind text not null default 'holiday' check (kind in ('holiday','custom')),
  wake_time time, leave_time time, return_time time, last_evening_start time,
  note text,
  unique (user_id, on_date)
);

-- trigger: fine = inizio + durata (la durata è la fonte di verità), versione, default stampante
create function print_jobs_before_write() returns trigger language plpgsql as $$
begin
  if new.printer_id is null then
    select id into new.printer_id from printers where user_id = new.user_id and is_default limit 1;
  end if;
  new.planned_end := case when new.planned_start is null then null
    else new.planned_start + make_interval(mins => new.duration_minutes) end;
  if tg_op = 'UPDATE' then new.version := old.version + 1; end if;
  new.updated_at := now();
  return new;
end $$;
create trigger print_jobs_bw before insert or update on print_jobs
  for each row execute function print_jobs_before_write();

-- nuovo utente: profilo, impostazioni, stampante e disponibilità iniziali
create function handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles(id) values (new.id);
  insert into user_settings(user_id) values (new.id);
  insert into printers(user_id, is_default) values (new.id, true);
  insert into availability_rules(user_id, weekday) select new.id, d from generate_series(0,6) d;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- ########## 0002_rls.sql ##########
-- PrintFlow - 0002: Row Level Security
alter table profiles enable row level security;
create policy profiles_select on profiles for select to authenticated using (id = (select auth.uid()));
create policy profiles_insert on profiles for insert to authenticated with check (id = (select auth.uid()));
create policy profiles_update on profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy profiles_delete on profiles for delete to authenticated using (id = (select auth.uid()));

do $$
declare t text;
begin
  foreach t in array array['user_settings','printers','print_templates','print_jobs','availability_rules','availability_exceptions'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select to authenticated using (user_id = (select auth.uid()))', t||'_select', t);
    execute format('create policy %I on %I for insert to authenticated with check (user_id = (select auth.uid()))', t||'_insert', t);
    execute format('create policy %I on %I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t||'_update', t);
    execute format('create policy %I on %I for delete to authenticated using (user_id = (select auth.uid()))', t||'_delete', t);
  end loop;
end $$;

-- sincronizzazione tra dispositivi (la RLS filtra anche il realtime)
alter publication supabase_realtime add table print_jobs, print_templates;

-- ########## 0003_scheduling_rpc.sql ##########
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

-- ########## 0004_fix_template_fk.sql ##########
-- Correzione 0001: eliminando un modello le lavorazioni restano (template_id = null), user_id no.
-- Richiede PostgreSQL 15+ (Supabase).
alter table print_jobs drop constraint print_jobs_template_id_user_id_fkey;
alter table print_jobs add constraint print_jobs_template_id_user_id_fkey
  foreign key (template_id, user_id) references print_templates(id, user_id) on delete set null (template_id);

-- ########## 0005_backfill_defaults.sql ##########
-- Idempotente: crea profilo, impostazioni, stampante e disponibilità iniziali per gli utenti
-- registrati PRIMA di aver eseguito 0001 (il trigger on_auth_user_created non è scattato per loro).
insert into profiles(id) select id from auth.users on conflict do nothing;
insert into user_settings(user_id) select id from auth.users on conflict do nothing;
insert into printers(user_id, is_default) select u.id, true from auth.users u
  where not exists (select 1 from printers p where p.user_id = u.id);
insert into availability_rules(user_id, weekday) select u.id, d from auth.users u cross join generate_series(0,6) d
  on conflict do nothing;

-- ########## 0006_sync_and_versions.sql ##########
-- Fase 5: versione sui modelli (protezione da aggiornamenti concorrenti) e realtime su tutte le tabelle usate.
alter table print_templates add column version int not null default 1;
create function print_templates_bump() returns trigger language plpgsql as $$
begin new.version := old.version + 1; return new; end $$;
create trigger print_templates_bump_v before update on print_templates
  for each row execute function print_templates_bump();
alter publication supabase_realtime add table availability_rules, availability_exceptions, user_settings;

-- ########## 0007_import.sql ##########
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

-- ########## 0008_grants.sql ##########
-- Permessi per l'API di Supabase: i progetti recenti NON concedono più automaticamente l'accesso alle tabelle create via SQL.
-- Solo gli utenti autenticati (mai anon); la sicurezza per riga resta garantita dalla RLS.
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant execute on functions to authenticated;
