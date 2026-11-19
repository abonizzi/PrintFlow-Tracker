# Funzionalità, regole e modifiche future

## Regole fondamentali
- **La durata è la fonte di verità**: `fine = inizio + durata` (minuti reali), calcolata dal database (trigger) e dal client (`src/lib/time.ts`). Mai salvata a mano.
- **Orari**: salvati in UTC (`timestamptz`), mostrati/inseriti in **Europe/Rome**. Il giorno ha 23, 24 o 25 ore nei cambi di ora legale; la timeline usa minuti reali.
- **Una stampante**, nessuna sovrapposizione; **intervallo minimo** (default 15 min, Impostazioni). Controllo in `schedule_job` (con blocco sulla stampante) + vincolo di esclusione sul database come rete di sicurezza.
- **Nessun cambio automatico**: né di stato (completata solo con conferma), né di priorità, né di altre lavorazioni in caso di conflitto.
- **Avvisi di disponibilità** (risveglio, uscita/rientro, ultimo avvio serale, festivi): solo avvisi, con "Programma comunque". Contano solo gli orari di *inizio*.

## Dove sta cosa
| Area | File |
|---|---|
| Schema, RLS, funzioni | `supabase/migrations/0001…0007` |
| Calcoli orari/giorni/snap | `src/lib/time.ts` |
| Statistiche e conflitti dashboard | `src/lib/stats.ts` |
| Disponibilità e avvisi | `src/lib/availability.ts` |
| Timeline (drag & drop, zoom, orizzontale/verticale) | `src/components/Timeline.tsx` |
| Archivio modelli (ogni ripetizione = record in `print_jobs`) | `src/components/Archive.tsx`, `src/hooks/useTemplates.ts` |
| Stati, completamento, checklist | `StatusActions.tsx`, `Dashboard.tsx`, `useJobs.ts` |
| Importazione (JSON/PDF/CSV, mappatura, duplicati, conflitti) | `ImportWizard.tsx`, `importer.ts`, `tableImport.ts`, `pdfText.ts`, `useImport.ts`, RPC `import_jobs` |
| Esportazioni e backup | `exporters.ts`, `exportPdf.ts`, `backup.ts` |
| Sincronizzazione live e indicatore | `useRealtime.ts`, `SyncStatus.tsx` |

## Importazione: regole
Origine unica `printflow-export` + `external_id` (PF-xxx) + utente = riconoscimento dei duplicati, uguale per JSON e PDF. Duplicato → ignora / aggiorna / nuova.
Conflitto di calendario → importata come "Da programmare", orario originale in `import_meta`. Una voce con N ripetizioni → N record (solo il primo mantiene stato/orario).
Stampe con stesso nome, pezzi e durata confluiscono nello stesso modello. Nulla viene salvato prima di "Importa", e il salvataggio è tutto-o-niente.

## Limiti noti
Nessun OCR per PDF scansionati · il PDF esportato non contiene anno nelle date, note e orari effettivi (usa il JSON) · il backup non ha ripristino automatico ·
una sola stampante nell'interfaccia (lo schema ne supporta più) · le finestre di cambio piatto personalizzate (`availability_rules.change_windows`) non hanno interfaccia ·
fuso orario fisso su Europe/Rome · snap e zoom sono per-dispositivo (lo snap predefinito è nelle impostazioni) · componenti UI in Tailwind semplice, non ancora shadcn/ui ·
gli errori di rete non bloccanti usano avvisi del browser.

## Idee per modifiche future (da dove partire)
- **Più stampanti**: aggiungi selezione stampante in `Timeline.tsx` (una corsia per stampante) e usa `printer_id` in `schedule_job`/`import_jobs` (oggi prendono quella predefinita).
- **Finestre di cambio piatto**: UI in `Settings.tsx` su `change_windows` e uso in `checkStart` (`availability.ts`).
- **Ripristino backup**: RPC transazionale analoga a `import_jobs`, con mappa degli ID.
- **OCR opzionale**: nuovo modulo prima di `buildTable`, con campi incerti evidenziati.
- **Notifiche**: promemoria prima dell'orario di cambio piatto (Web Push o calendario).
- **shadcn/ui**: sostituisci i controlli in `Archive.tsx`, `Settings.tsx`, `ImportWizard.tsx` mantenendo gli stessi handler.
- **Nuove regole di calendario**: aggiungile in `schedule_job` (SQL) *e* in `stats.ts`/`importer.ts`, così client, dashboard e database restano coerenti; aggiungi un caso a `isolamento_e_conflitti.sql`.
