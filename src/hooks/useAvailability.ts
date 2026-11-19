import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Exc, Rule, Settings } from '../lib/availability';

export const useAvailability = () => useQuery({
  queryKey: ['availability'],
  queryFn: async () => {
    const [r, e, s] = await Promise.all([
      supabase.from('availability_rules').select('*').order('weekday'),
      supabase.from('availability_exceptions').select('*').order('on_date'),
      supabase.from('user_settings').select('*').maybeSingle(),
    ]);
    if (r.error) throw r.error; if (e.error) throw e.error; if (s.error) throw s.error;
    return { rules: r.data as Rule[], exceptions: e.data as Exc[], settings: s.data as Settings | null };
  },
});

async function uid() {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error('Sessione scaduta: accedi di nuovo');
  return data.user.id;
}
function useMut<V>(fn: (v: V) => Promise<void>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: ['availability'] }) });
}
export const useUpdateRule = () => useMut(async ({ id, patch }: { id: string; patch: Partial<Omit<Rule, 'id' | 'weekday'>> }) => {
  const { error } = await supabase.from('availability_rules').update(patch).eq('id', id); if (error) throw error;
});
export const useSaveException = () => useMut(async (row: Omit<Exc, 'id'>) => {
  const { error } = await supabase.from('availability_exceptions').upsert({ ...row, user_id: await uid() }, { onConflict: 'user_id,on_date' });
  if (error) throw error;
});
export const useDeleteException = () => useMut(async (id: string) => {
  const { error } = await supabase.from('availability_exceptions').delete().eq('id', id); if (error) throw error;
});
export const useUpdateSettings = () => useMut(async (patch: Partial<Pick<Settings, 'changeover_minutes' | 'snap_minutes'>>) => {
  const { error } = await supabase.from('user_settings').update(patch).eq('user_id', await uid()); if (error) throw error;
});
