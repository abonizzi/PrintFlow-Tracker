-- Idempotente: crea profilo, impostazioni, stampante e disponibilità iniziali per gli utenti
-- registrati PRIMA di aver eseguito 0001 (il trigger on_auth_user_created non è scattato per loro).
insert into profiles(id) select id from auth.users on conflict do nothing;
insert into user_settings(user_id) select id from auth.users on conflict do nothing;
insert into printers(user_id, is_default) select u.id, true from auth.users u
  where not exists (select 1 from printers p where p.user_id = u.id);
insert into availability_rules(user_id, weekday) select u.id, d from auth.users u cross join generate_series(0,6) d
  on conflict do nothing;
