# PrintFlow — planner visuale per stampe 3D

Web app/PWA per pianificare a mano le stampe 3D su una timeline di 24 ore, con archivio dei modelli, conflitti, disponibilità personale,
dashboard, importazione/esportazione e sincronizzazione tra dispositivi (React + TypeScript + Vite, Tailwind, TanStack Query, dnd-kit, Supabase, Netlify).

> **Stato:** il codice è stato scritto senza poter eseguire installazione, build e test. Al primo push controlla la scheda **Actions** di GitHub
> (typecheck + test) e il log di build di Netlify: eventuali errori vanno corretti prima dell'uso. Il collaudo reale è: login, import del tuo JSON/PDF, trascinamento sulla timeline.

## 1. Configurare Supabase
1. Crea un progetto su supabase.com.
2. **SQL Editor** → incolla ed esegui **`supabase/setup_completo.sql`** (contiene tutto, una volta sola). In alternativa esegui, **in questo ordine**, i file di `supabase/migrations/`: `0001_schema`, `0002_rls`, `0003_scheduling_rpc`, `0004_fix_template_fk`, `0005_backfill_defaults`, `0006_sync_and_versions`, `0007_import`, `0008_grants`.
   (la 0005 è innocua se non hai utenti precedenti; la 0004 richiede PostgreSQL 15+, già il caso di Supabase).
3. **Authentication → Providers**: lascia attivo Email. Se vuoi accedere subito senza mail di conferma, disattiva "Confirm email".
4. **Authentication → URL Configuration**: imposta *Site URL* con l'indirizzo Netlify (quando lo avrai) per i link di conferma.
5. **Project Settings → API**: copia *Project URL* e la chiave pubblica **anon**. Non usare mai la *service role key* nel frontend.
6. (Facoltativo) esegui `supabase/tests/isolamento_e_conflitti.sql` per verificare RLS, conflitti, versioni e import transazionale: l'ultima tabella deve mostrare solo OK.

## 2. GitHub
```bash
git init && git add . && git commit -m "PrintFlow"
git branch -M main
git remote add origin https://github.com/<utente>/printflow.git
git push -u origin main
```
A ogni push parte il workflow `.github/workflows/ci.yml` (typecheck e test).

## 3. Netlify
1. *Add new site → Import an existing project* → scegli il repository.
2. Build command `npm run build`, publish directory `dist` (già in `netlify.toml`).
3. **Site configuration → Environment variables**: `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` (vedi `.env.example`). Poi *Deploy*.
4. Apri l'indirizzo, registrati, e dal browser usa *Installa app* (Android/desktop) per la PWA.

## 4. Primo utilizzo
Dashboard → **Importa stampe** → carica `printflow_importazione.json` (o il PDF/CSV) → controlla l'anteprima → **Importa**.
Le stampe finiscono nell'archivio, quelle con orario valido anche nella timeline. Impostazioni → Disponibilità per orari di casa e intervallo minimo.

## 5. Sviluppo locale (facoltativo)
`cp .env.example .env` (compila i valori) · `npm install` · `npm run dev` · `npm test` · `npm run typecheck`

## 6. Test
| Dove | Cosa |
|---|---|
| `src/lib/*.test.ts` (Vitest, in CI) | calcolo orari, mezzanotte, ora legale (23/25 h), durate > 24 h, snap, sovrapposizioni, intervallo minimo, ripetizioni, import JSON/CSV/PDF (multipagina, campi mancanti, duplicati, notturne, completate, opzionali, conflitti, reimport), statistiche, disponibilità |
| `supabase/tests/isolamento_e_conflitti.sql` | isolamento tra utenti, conflitti lato database, versioni, importazione tutto-o-niente, ID duplicati |
| Manuale (in fondo allo stesso file) | due dispositivi che salvano in contemporanea |
| Manuale | trascinamento e uso touch su smartphone (non automatizzabile qui): prova pressione lunga sul blocco, modulo data/ora, modalità verticale |

## 7. Problemi comuni
- *"Mancano VITE_SUPABASE_URL…"*: variabili non impostate su Netlify (serve un nuovo deploy dopo averle aggiunte).
- Nessuna lavorazione creabile / archivio vuoto dopo il login: esegui `0005_backfill_defaults.sql` (utente registrato prima dello schema).
- Niente sincronizzazione live: verifica `0002` e `0006` (tabelle nella publication `supabase_realtime`); l'indicatore in alto mostra "Offline" se il canale non si collega.
- Conflitto "23P01"/sovrapposizione: due stampe sulla stessa stampante non possono coincidere; il messaggio indica quale.
- Il PDF non viene letto: se è una scansione serve un OCR (non incluso); usa il JSON.

Documentazione delle funzionalità e guida alle modifiche: `docs/FUNZIONALITA.md`.
