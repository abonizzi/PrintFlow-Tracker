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
