-- Fase 5: versione sui modelli (protezione da aggiornamenti concorrenti) e realtime su tutte le tabelle usate.
alter table print_templates add column version int not null default 1;
create function print_templates_bump() returns trigger language plpgsql as $$
begin new.version := old.version + 1; return new; end $$;
create trigger print_templates_bump_v before update on print_templates
  for each row execute function print_templates_bump();
alter publication supabase_realtime add table availability_rules, availability_exceptions, user_settings;
