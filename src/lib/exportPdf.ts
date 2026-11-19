import { formatInTimeZone } from 'date-fns-tz';
import { it } from 'date-fns/locale';
import type { Job } from '../hooks/useJobs';
import { TZ_DEFAULT as TZ, fmtTime } from './time';
import { PRIORITY_LABEL, STATUS_LABEL, fmtDuration } from './types';

/** PDF tabellare con le stesse colonne dell'archivio di esempio, quindi rileggibile dal parser. Per il formato senza perdite usa il JSON. */
export async function exportPdf(jobs: Job[], changeoverMinutes = 15) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  doc.setFontSize(14); doc.text('PRINTFLOW | Archivio stampe 3D', 30, 36);
  doc.setFontSize(9);
  doc.text(`Esportazione strutturata - ${formatInTimeZone(new Date(), TZ, 'd MMMM yyyy', { locale: it })} | Fuso: ${TZ} | Stampanti: 1 | Cambio piatto: ${changeoverMinutes} minuti`, 30, 52);
  const when = (v: string | null) => (v ? fmtTime(v, TZ, 'dd/MM HH:mm') : '-');
  const body = [...jobs].sort((a, b) => (a.planned_start ?? '9').localeCompare(b.planned_start ?? '9') || a.name.localeCompare(b.name)).map(j => [
    j.external_id ?? `PFX-${j.id.slice(0, 8)}`, j.name, String(j.pieces_per_plate), fmtDuration(j.duration_minutes), PRIORITY_LABEL[j.priority],
    STATUS_LABEL[j.status] + (j.optional ? ' (opz.)' : ''), when(j.planned_start), when(j.planned_end)]);
  autoTable(doc, { startY: 66, margin: { left: 30, right: 30 }, styles: { fontSize: 8, cellPadding: 3 }, headStyles: { fillColor: [30, 41, 59] },
    head: [['ID', 'Stampa', 'Pezzi', 'Durata', 'Priorità', 'Stato', 'Inizio pianificato', 'Fine pianificata']], body });
  doc.save(`printflow_archivio_${fmtTime(new Date(), TZ, 'yyMMdd_HHmmss')}.pdf`);
}
