import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { JobLite, Template, TemplateDraft } from '../lib/types';

export const useTemplates = () => useQuery({
  queryKey: ['templates'],
  queryFn: async () => {
    const { data, error } = await supabase.from('print_templates').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return data as Template[];
  },
});

export const useJobsLite = () => useQuery({
  queryKey: ['jobs-lite'],
  queryFn: async () => {
    const { data, error } = await supabase.from('print_jobs').select('id,template_id,status');
    if (error) throw error;
    return data as JobLite[];
  },
});

async function userId() {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error('Sessione scaduta: accedi di nuovo');
  return data.user.id;
}

const fields = (d: TemplateDraft) => ({ name: d.name, description: d.description, pieces_per_plate: d.pieces_per_plate,
  duration_minutes: d.duration_minutes, repetitions: d.repetitions, priority: d.priority, color: d.color,
  notes: d.notes, divisible: d.divisible, preview_url: d.preview_url });

function jobRows(uid: string, tid: string, d: TemplateDraft, from: number, to: number) {
  const rows = [];
  for (let i = from; i <= to; i++) rows.push({
    user_id: uid, template_id: tid, repetition_index: i, name: d.name, pieces_per_plate: d.pieces_per_plate,
    duration_minutes: d.duration_minutes, priority: d.priority, status: 'to_schedule',
  });
  return rows;
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: ['templates'] }), qc.invalidateQueries({ queryKey: ['jobs-lite'] })]);
}

/** Crea o modifica un modello; ogni ripetizione è un record distinto in print_jobs. */
export function useSaveTemplate() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: async ({ id, draft, version }: { id?: string; version?: number; draft: TemplateDraft }) => {
      const uid = await userId();
      let tid = id; let existing = 0;
      if (id) {
        let q = supabase.from('print_templates').update(fields(draft)).eq('id', id);
        if (version !== undefined) q = q.eq('version', version);
        const u = await q.select('id');
        if (u.error) throw u.error;
        if (u.data.length === 0) throw new Error('Modello modificato da un altro dispositivo: i dati sono stati aggiornati, riapri la scheda e riprova.');
        const js = await supabase.from('print_jobs').select('id').eq('template_id', id);
        if (js.error) throw js.error;
        existing = js.data.length;
        // le modifiche si propagano solo alle lavorazioni ancora da programmare
        const p = await supabase.from('print_jobs').update({
          name: draft.name, pieces_per_plate: draft.pieces_per_plate,
          duration_minutes: draft.duration_minutes, priority: draft.priority,
        }).eq('template_id', id).eq('status', 'to_schedule');
        if (p.error) throw p.error;
      } else {
        const c = await supabase.from('print_templates').insert({ ...fields(draft), user_id: uid }).select('id').single();
        if (c.error) throw c.error;
        tid = c.data.id;
      }
      if (draft.repetitions > existing) {
        const r = await supabase.from('print_jobs').insert(jobRows(uid, tid!, draft, existing + 1, draft.repetitions));
        if (r.error) throw r.error;
      }
    },
    onSuccess: inv,
  });
}

export function useDuplicateTemplate() {
  const save = useSaveTemplate();
  return (t: Template) => {
    const { id: _i, created_at: _c, archived_at: _a, version: _v, ...rest } = t;
    return save.mutateAsync({ draft: { ...rest, name: `${t.name} (copia)` } });
  };
}

export function useArchiveTemplate() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: async (t: Template) => {
      const { error } = await supabase.from('print_templates')
        .update({ archived_at: t.archived_at ? null : new Date().toISOString() }).eq('id', t.id);
      if (error) throw error;
    },
    onSuccess: inv,
  });
}

/** Elimina il modello e le lavorazioni "da programmare"; programmate/completate restano nello storico. */
export function useDeleteTemplate() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: async (id: string) => {
      const j = await supabase.from('print_jobs').delete().eq('template_id', id).eq('status', 'to_schedule');
      if (j.error) throw j.error;
      const { error } = await supabase.from('print_templates').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: inv,
  });
}
