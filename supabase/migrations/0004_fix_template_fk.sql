-- Correzione 0001: eliminando un modello le lavorazioni restano (template_id = null), user_id no.
-- Richiede PostgreSQL 15+ (Supabase).
alter table print_jobs drop constraint print_jobs_template_id_user_id_fkey;
alter table print_jobs add constraint print_jobs_template_id_user_id_fkey
  foreign key (template_id, user_id) references print_templates(id, user_id) on delete set null (template_id);
