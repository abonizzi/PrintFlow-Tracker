import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { computeEnd } from '../lib/time';
import type { JobStatus, Priority } from '../lib/types';

export interface Job {
  id: string; template_id: string | null; repetition_index: number | null; name: string; pieces_per_plate: number;
  duration_minutes: number; priority: Priority; status: JobStatus; optional: boolean;
  planned_start: string | null; planned_end: string | null; actual_start: string | null; actual_end: string | null;
  version: number; notes: string | null; external_id?: string | null; import_source?: string | null;
}
export interface ConflictInfo { job_id: string; name: string; planned_start: string; planned_end: string; reason: 'overlap' | 'min_gap' }
export class ScheduleError extends Error {
  constructor(public result: { error: string; conflicts?: ConflictInfo[]; suggested_start?: string }) {
    super(result.error === 'conflict' ? 'Conflitto di programmazione'
      : result.error === 'version_conflict' ? 'La lavorazione è stata modificata da un altro dispositivo: dati aggiornati, riprova' : 'Programmazione non riuscita');
  }
}
const KEY = ['jobs-lite', 'full'];  // prefisso condiviso con ['jobs-lite']: le invalidazioni dell'archivio valgono anche qui

export const useJobs = () => useQuery({
  queryKey: KEY,
  queryFn: async () => {
    const { data, error } = await supabase.from('print_jobs').select('*').order('planned_start', { nullsFirst: false });
    if (error) throw error;
    return data as Job[];
  },
});

/** Programma o sposta tramite RPC transazionale; aggiornamento ottimistico con rollback. */
export function useScheduleJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ job, start }: { job: Job; start: Date }) => {
      const { data, error } = await supabase.rpc('schedule_job', {
        p_job_id: job.id, p_start: start.toISOString(), p_expected_version: job.version });
      if (error) throw error;
      if (!data.ok) throw new ScheduleError(data);
      return data.job as Job;
    },
    onMutate: async ({ job, start }) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<Job[]>(KEY);
      qc.setQueryData<Job[]>(KEY, old => old?.map(j => j.id !== job.id ? j : {
        ...j, planned_start: start.toISOString(), planned_end: computeEnd(start, j.duration_minutes).toISOString(),
        status: j.status === 'to_schedule' ? 'scheduled' : j.status }));
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(KEY, ctx.prev); },
    onSettled: () => qc.invalidateQueries({ queryKey: ['jobs-lite'] }),
  });
}

export function useUnscheduleJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (job: Job) => {
      const { data, error } = await supabase.from('print_jobs')
        .update({ planned_start: null, status: 'to_schedule' }).eq('id', job.id).eq('version', job.version).select('id');
      if (error) throw error;
      if (data.length === 0) throw new ScheduleError({ error: 'version_conflict' });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['jobs-lite'] }),
  });
}

export interface StatusPatch { job: Job; status: JobStatus; actual_start?: string | null; actual_end?: string | null }
async function setStatusRow({ job, status, ...extra }: StatusPatch) {
  const { data, error } = await supabase.from('print_jobs').update({ status, ...extra })
    .eq('id', job.id).eq('version', job.version).select('id');
  if (error) throw error.code === '23P01' ? new Error("L'orario si sovrappone a un'altra lavorazione") : error;
  if (data.length === 0) throw new ScheduleError({ error: 'version_conflict' });
}
/** Cambio di stato esplicito: nessuna stampa diventa "completata" da sola. */
export function useSetStatus() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: setStatusRow, onSettled: () => qc.invalidateQueries({ queryKey: ['jobs-lite'] }) });
}
export function useBulkComplete() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (jobs: Job[]) => {
      const res = await Promise.allSettled(jobs.map(job => setStatusRow({ job, status: 'completed' })));
      const failed = res.filter(r => r.status === 'rejected').length;
      if (failed) throw new Error(`${failed} lavorazioni su ${jobs.length} non aggiornate (modificate altrove): dati ricaricati, riprova`);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['jobs-lite'] }),
  });
}
