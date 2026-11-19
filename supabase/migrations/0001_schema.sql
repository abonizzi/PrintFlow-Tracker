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
