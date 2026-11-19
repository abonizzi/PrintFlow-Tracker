import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { IMPORT_SOURCE } from '../lib/importer';

/** Importazione in un'unica transazione (RPC import_jobs): o salva tutto o non salva nulla. */
export function useImportJobs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ rows, batch }: { rows: Record<string, unknown>[]; batch: { filename: string; skipped: number; demoted: number } }) => {
      const { data, error } = await supabase.rpc('import_jobs', { p_source: IMPORT_SOURCE, p_rows: rows, p_batch: batch });
      if (error) {
        if (error.message.startsWith('conflict:')) throw new Error(`Conflitto di calendario su ${error.message.slice(9).trim()}: la programmazione è cambiata nel frattempo. Nessun dato salvato: riapri la procedura.`);
        if (error.code === '23505') throw new Error('Alcune lavorazioni risultano già importate (stesso ID). Nessun dato salvato: riapri la procedura.');
        throw new Error(`Importazione annullata, nessun dato salvato: ${error.message}`);
      }
      return data as { inserted: number; updated: number };
    },
    onSettled: () => qc.invalidateQueries(),
  });
}
