import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export type LiveStatus = 'connecting' | 'live' | 'offline';
const TABLES: Record<string, string> = {
  print_jobs: 'jobs-lite', print_templates: 'templates',
  availability_rules: 'availability', availability_exceptions: 'availability', user_settings: 'availability',
};

/** Sincronizzazione tra dispositivi: ogni modifica remota (filtrata dalla RLS) invalida la query relativa. */
export function useRealtime(): LiveStatus {
  const qc = useQueryClient();
  const [status, setStatus] = useState<LiveStatus>('connecting');
  useEffect(() => {
    const pending = new Set<string>(); let timer: ReturnType<typeof setTimeout> | undefined;
    const touch = (key: string) => {
      pending.add(key); clearTimeout(timer);
      timer = setTimeout(() => { pending.forEach(k => qc.invalidateQueries({ queryKey: [k] })); pending.clear(); }, 150);
    };
    const ch = supabase.channel('printflow-sync');
    for (const [table, key] of Object.entries(TABLES))
      ch.on('postgres_changes', { event: '*', schema: 'public', table }, () => touch(key));
    ch.subscribe(s => {
      if (s === 'SUBSCRIBED') { setStatus('live'); qc.invalidateQueries(); }   // dopo una riconnessione recupera ciò che è stato perso
      else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') setStatus('offline');
    });
    const off = () => setStatus('offline');
    const on = () => { setStatus('connecting'); qc.invalidateQueries(); };
    window.addEventListener('offline', off); window.addEventListener('online', on);
    return () => { clearTimeout(timer); window.removeEventListener('offline', off); window.removeEventListener('online', on); supabase.removeChannel(ch); };
  }, [qc]);
  return status;
}
