-- PrintFlow - test del database: isolamento tra utenti (RLS), conflitti, versioni, importazione transazionale.
-- COME USARLO: incolla tutto nello SQL Editor di Supabase ed esegui. L'ultima istruzione mostra una tabella con OK / FALLITO.
-- Lo script apre una transazione e NON la chiude: a fine esecuzione non resta nulla (se vuoi esserne certo esegui poi:  rollback; ).
-- Se l'insert su auth.users fallisce per colonne obbligatorie, crea due utenti da Authentication > Users e sostituisci gli UUID.

delete from auth.users where email like '%@printflow.test';   -- pulizia di eventuali residui di esecuzioni interrotte
begin;
create temp table t(name text, ok boolean);
grant all on t to authenticated;

insert into auth.users(id, aud, role, email) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'authenticated', 'authenticated', 'test-a@printflow.test'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'authenticated', 'authenticated', 'test-b@printflow.test');
insert into t select 'la registrazione crea stampante, 7 regole e impostazioni',
  (select count(*) from printers where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') = 1
  and (select count(*) from availability_rules where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') = 7
  and (select changeover_minutes from user_settings where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') = 15;
create temp table ids as select id as printer_a from printers where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
grant select on ids to authenticated;

-- ===== utente A =====
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);
set local role authenticated;

insert into print_templates(id, user_id, name, duration_minutes)
  values ('a1000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Modello A', 127);
insert into print_jobs(id, user_id, template_id, name, duration_minutes, status, planned_start) values
  ('a2000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1000000-0000-0000-0000-000000000001', 'J1', 127, 'scheduled', '2026-11-17 19:00+01'),
  ('a2000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', null, 'J2', 60, 'to_schedule', null);

insert into t select 'fine = inizio + durata (19:00 + 2h07 = 21:07)', planned_end = '2026-11-17 21:07+01'
  from print_jobs where id = 'a2000000-0000-0000-0000-000000000001';
insert into t select 'stampa notturna: 21:22 + 6h06 = 03:28 del giorno dopo',
  (timestamptz '2026-11-17 21:22+01' + make_interval(mins => 366)) = timestamptz '2026-11-18 03:28+01';

insert into t select 'sovrapposizione rifiutata, suggerito il primo orario libero (21:22)',
  r->>'error' = 'conflict' and (r->>'suggested_start')::timestamptz = '2026-11-17 21:22+01'
  from (select schedule_job('a2000000-0000-0000-0000-000000000002', '2026-11-17 20:00+01') r) x;
insert into t select 'intervallo minimo: 14 minuti non bastano',
  r->>'error' = 'conflict' and r->'conflicts'->0->>'reason' = 'min_gap'
  from (select schedule_job('a2000000-0000-0000-0000-000000000002', '2026-11-17 21:21+01') r) x;
insert into t select 'una stampa rifiutata non viene salvata',
  (select status = 'to_schedule' and planned_start is null from print_jobs where id = 'a2000000-0000-0000-0000-000000000002');
-- (la funzione e la verifica dei dati stanno in istruzioni separate: nella stessa query la verifica non vedrebbe le modifiche)
do $$ declare r jsonb; begin
  r := schedule_job('a2000000-0000-0000-0000-000000000002', '2026-11-17 21:22+01');
  insert into t select 'intervallo minimo: 15 minuti bastano, stato diventa programmata',
    (r->>'ok')::boolean and (select status = 'scheduled' and planned_end = '2026-11-17 22:22+01' from print_jobs where id = 'a2000000-0000-0000-0000-000000000002');
end $$;
insert into t select 'versione obsoleta rifiutata (modifica da un altro dispositivo)',
  r->>'error' = 'version_conflict'
  from (select schedule_job('a2000000-0000-0000-0000-000000000002', '2026-11-18 10:00+01', 1) r) x;

do $$ begin
  update print_jobs set planned_start = '2026-11-17 20:00+01' where id = 'a2000000-0000-0000-0000-000000000002';
  insert into t values ('il vincolo del database blocca la sovrapposizione anche senza la funzione', false);
exception when exclusion_violation then
  insert into t values ('il vincolo del database blocca la sovrapposizione anche senza la funzione', true);
end $$;

do $$ declare n int; begin
  begin
    perform import_jobs('test', '[
      {"action":"insert","external_id":"T-1","name":"Imp1","pieces_per_plate":1,"duration_minutes":30,"priority":"low","status":"scheduled","planned_start":"2026-11-20T10:00:00+01:00"},
      {"action":"insert","external_id":"T-2","name":"Imp2","pieces_per_plate":1,"duration_minutes":30,"priority":"low","status":"scheduled","planned_start":"2026-11-20T10:10:00+01:00"}]'::jsonb);
    insert into t values ('importazione con conflitto: annullata per intero', false);
  exception when others then
    select count(*) into n from print_jobs where external_id in ('T-1', 'T-2');
    insert into t values ('importazione con conflitto: annullata per intero (nessun salvataggio parziale)', n = 0);
  end;
end $$;
do $$ declare r jsonb; begin
  r := import_jobs('test', '[{"action":"insert","external_id":"T-3","name":"Imp3","pieces_per_plate":2,"duration_minutes":30,"priority":"low","status":"scheduled","planned_start":"2026-11-20T10:00:00+01:00"}]'::jsonb);
  insert into t select 'importazione valida: inserisce la lavorazione e crea il modello',
    (r->>'inserted')::int = 1 and exists (select 1 from print_templates where name = 'Imp3') and exists (select 1 from print_jobs where external_id = 'T-3');
end $$;
do $$ begin
  perform import_jobs('test', '[{"action":"insert","external_id":"T-3","name":"Imp3","pieces_per_plate":2,"duration_minutes":30,"priority":"low","status":"scheduled","planned_start":"2026-11-21T10:00:00+01:00"}]'::jsonb);
  insert into t values ('lo stesso ID importato due volte viene rifiutato', false);
exception when unique_violation then
  insert into t values ('lo stesso ID importato due volte viene rifiutato', true);
end $$;

-- ===== utente B (isolamento) =====
reset role;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', true);
set local role authenticated;

insert into t select 'B non vede lavorazioni, modelli e regole di A',
  (select count(*) from print_jobs) = 0 and (select count(*) from print_templates) = 0
  and (select count(*) from printers) = 1 and (select count(*) from availability_rules) = 7;
update print_jobs set name = 'hack' where id = 'a2000000-0000-0000-0000-000000000001';
delete from print_jobs where id = 'a2000000-0000-0000-0000-000000000001';
insert into t select 'B non può programmare lavorazioni di A',
  r->>'error' = 'not_found' from (select schedule_job('a2000000-0000-0000-0000-000000000001', '2026-11-25 10:00+01') r) x;
do $$ begin
  insert into print_jobs(user_id, name, duration_minutes) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'x', 10);
  insert into t values ('B non può inserire dati a nome di A', false);
exception when insufficient_privilege or not_null_violation then
  insert into t values ('B non può inserire dati a nome di A', true);
end $$;
do $$ begin
  insert into print_jobs(user_id, printer_id, name, duration_minutes)
    values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', (select printer_a from ids), 'x', 10);
  insert into t values ('B non può usare la stampante di A', false);
exception when foreign_key_violation then
  insert into t values ('B non può usare la stampante di A', true);
end $$;

reset role;
insert into t select 'i dati di A sono rimasti intatti dopo i tentativi di B',
  (select name from print_jobs where id = 'a2000000-0000-0000-0000-000000000001') = 'J1';

select name as test, case when ok then 'OK' else 'FALLITO' end as esito from t;

-- ===== TEST MANUALE DI CONCORRENZA (due dispositivi che salvano insieme) =====
-- Servono due schede dello SQL Editor e una lavorazione reale. Sostituisci <ID> con l'id di una lavorazione da programmare.
-- Scheda 1:  begin;  select schedule_job('<ID>', '2027-01-10 10:00+01');      -- NON fare commit
-- Scheda 2:  select schedule_job('<ID2>', '2027-01-10 10:05+01');             -- resta in attesa (blocco sulla stampante)
-- Scheda 1:  commit;                                                           -- la scheda 2 si sblocca e risponde "conflict"
-- Così due dispositivi non possono mai salvare lavorazioni sovrapposte.
