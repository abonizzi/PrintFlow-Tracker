-- Permessi per l'API di Supabase: i progetti recenti NON concedono più automaticamente l'accesso alle tabelle create via SQL.
-- Solo gli utenti autenticati (mai anon); la sicurezza per riga resta garantita dalla RLS.
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant execute on functions to authenticated;
