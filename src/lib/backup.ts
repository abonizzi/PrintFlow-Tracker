import { supabase } from './supabase';
import { download } from './exporters';
import { todayStr } from './time';

/** Copia completa dei tuoi dati (la RLS limita ogni lettura al tuo account). Per riportare le lavorazioni usa anche l'export JSON. */
export async function downloadBackup() {
  const out: Record<string, unknown> = { app: 'printflow', backup_version: 1, exported_at: new Date().toISOString() };
  for (const t of ['printers', 'print_templates', 'print_jobs', 'availability_rules', 'availability_exceptions', 'user_settings', 'import_batches']) {
    const { data, error } = await supabase.from(t).select('*'); if (error) throw error; out[t] = data;
  }
  download(`printflow_backup_${todayStr()}.json`, JSON.stringify(out, null, 2), 'application/json');
}
