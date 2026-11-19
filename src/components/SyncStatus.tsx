import { useIsFetching, useIsMutating, useMutationState, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Cloud, CloudOff, RefreshCw } from 'lucide-react';
import { ScheduleError } from '../hooks/useJobs';
import type { LiveStatus } from '../hooks/useRealtime';

export function SyncStatus({ live }: { live: LiveStatus }) {
  const qc = useQueryClient();
  const saving = useIsMutating() > 0, fetching = useIsFetching() > 0;
  const last = useMutationState({ select: m => ({ s: m.state.status, at: m.state.submittedAt, e: m.state.error }) }).sort((a, b) => b.at - a.at)[0];
  const failed = last?.s === 'error' && !(last.e instanceof ScheduleError);   // un conflitto di calendario non è un errore di sync
  const [icon, label, cls] = live === 'offline' ? [<CloudOff key="i" className="h-4 w-4" />, 'Offline', 'text-slate-500']
    : failed ? [<AlertTriangle key="i" className="h-4 w-4" />, 'Errore di salvataggio', 'text-red-600']
    : saving ? [<RefreshCw key="i" className="h-4 w-4 animate-spin" />, 'Salvataggio…', 'text-amber-600']
    : fetching || live === 'connecting' ? [<RefreshCw key="i" className="h-4 w-4 animate-spin" />, 'Sincronizzazione…', 'text-amber-600']
    : [<Cloud key="i" className="h-4 w-4" />, 'Sincronizzato', 'text-emerald-600'];
  return (
    <button onClick={() => qc.invalidateQueries()} title="Sincronizza ora" aria-label={`${label}. Sincronizza ora`} className={`flex items-center gap-1 rounded-lg px-2 py-1 text-xs ${cls}`}>
      {icon}<span className="hidden sm:inline">{label}</span>
    </button>
  );
}
