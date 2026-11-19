import { useEffect, useMemo, useRef, useState } from 'react';
import { DndContext, DragOverlay, MouseSensor, TouchSensor, useDraggable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { AlertTriangle, ChevronLeft, ChevronRight, Undo2, ZoomIn, ZoomOut } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { it } from 'date-fns/locale';
import { ScheduleError, useJobs, useScheduleJob, useUnscheduleJob, type ConflictInfo, type Job } from '../hooks/useJobs';
import { useTemplates } from '../hooks/useTemplates';
import { StatusActions } from './StatusActions';
import { useAvailability, useUpdateSettings } from '../hooks/useAvailability';
import { checkStart, effective } from '../lib/availability';
import { MIN, TZ_DEFAULT as TZ, computeEnd, dayBounds, fmtTime, fromInputValue, hourMarks, segmentForDay, shiftDay, snapTo, todayStr, toInputValue } from '../lib/time';
import { PRIORITIES, PRIORITY_COLOR, PRIORITY_LABEL, fmtDuration } from '../lib/types';

function useMedia(q: string) {
  const [m, setM] = useState(() => matchMedia(q).matches);
  useEffect(() => { const mq = matchMedia(q); const f = () => setM(mq.matches); mq.addEventListener('change', f); return () => mq.removeEventListener('change', f); }, [q]);
  return m;
}
type Conflict = { job: Job; start: Date; error: ScheduleError['result'] };
type Warn = { job: Job; start: Date; warnings: string[] };
type UndoItem = { jobId: string; prevStart: string | null };
const btn = 'rounded-lg border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 disabled:opacity-40';

export function Timeline() {
  const { data: jobs = [] } = useJobs(); const { data: templates = [] } = useTemplates();
  const schedule = useScheduleJob(); const unschedule = useUnscheduleJob();
  const horizontal = useMedia('(min-width: 768px)');
  const [day, setDay] = useState(todayStr()); const [snap, setSnap] = useState(15);
  const [zoom, setZoom] = useState(() => matchMedia('(min-width: 768px)').matches ? 90 : 64);
  const [now, setNow] = useState(new Date()); const [edit, setEdit] = useState<Job | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null); const [undo, setUndo] = useState<UndoItem[]>([]);
  const [dragging, setDragging] = useState<Job | null>(null);
  const { data: av } = useAvailability(); const updSettings = useUpdateSettings(); const [warn, setWarn] = useState<Warn | null>(null);
  useEffect(() => { if (av?.settings) setSnap(av.settings.snap_minutes); }, [av?.settings?.snap_minutes]);
  const trackRef = useRef<HTMLDivElement>(null);
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(t); }, []);
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }));

  const ppm = zoom / 60; const { start: dayStart, minutes } = dayBounds(day, TZ); const len = minutes * ppm;
  const colorOf = (j: Job) => templates.find(t => t.id === j.template_id)?.color ?? PRIORITY_COLOR[j.priority];
  const pending = useMemo(() => jobs.filter(j => j.status === 'to_schedule')
    .sort((a, b) => PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority) || a.name.localeCompare(b.name)), [jobs]);
  const visible = jobs.filter(j => j.planned_start && j.planned_end && j.status !== 'cancelled')
    .map(j => ({ j, seg: segmentForDay(j.planned_start!, j.planned_end!, day, TZ) })).filter(x => x.seg);
  const a0 = av ? effective(day, av.rules, av.exceptions) : null;
  const offMin = (t: string) => (fromInputValue(`${day}T${t}`, TZ).getTime() - dayStart.getTime()) / MIN;
  const zones = a0 ? [{ a: 0, b: offMin(a0.wake), l: 'Notte' }, ...(a0.leave && a0.ret ? [{ a: offMin(a0.leave), b: offMin(a0.ret), l: 'Fuori casa' }] : []), { a: offMin(a0.last), b: minutes, l: 'Notte' }].filter(z => z.b > z.a) : [];
  const segs = visible.map(x => x.seg!).sort((p, q) => p.startMin - q.startMin);
  const gaps = segs.slice(1).map((sg, i) => ({ a: segs[i].startMin + segs[i].durMin, b: sg.startMin })).filter(g => g.b > g.a);
  const span = (a: number, b: number, h0: number, h1: number) => horizontal ? { left: a * ppm, width: (b - a) * ppm, top: h0, bottom: h1 } : { top: a * ppm, height: (b - a) * ppm, left: h0 ? 56 : 0, right: h1 };
  const hot = new Set((conflict?.error.conflicts ?? []).map(c => c.job_id));

  async function place(job: Job, start: Date, force = false) {
    if (job.planned_start && new Date(job.planned_start).getTime() === start.getTime()) return;
    if (!force && av) { const w = checkStart(start, av.rules, av.exceptions); if (w.length) { setWarn({ job, start, warnings: w }); setEdit(null); return; } }
    setWarn(null);
    try {
      await schedule.mutateAsync({ job, start });
      setUndo(u => [...u, { jobId: job.id, prevStart: job.planned_start }]); setConflict(null); setEdit(null);
    } catch (e) {
      if (e instanceof ScheduleError) { setConflict({ job, start, error: e.result }); setEdit(null); }
      else alert((e as Error).message);
    }
  }
  async function undoLast() {
    const last = undo[undo.length - 1]; const job = jobs.find(j => j.id === last?.jobId); if (!last || !job) return;
    setUndo(u => u.slice(0, -1));
    try { last.prevStart ? await schedule.mutateAsync({ job, start: new Date(last.prevStart) }) : await unschedule.mutateAsync(job); }
    catch (e) { alert((e as Error).message); }
  }
  function onDragEnd(e: DragEndEvent) {
    setDragging(null);
    const d = e.active.data.current as { kind: 'new' | 'move'; job: Job } | undefined; if (!d) return;
    if (d.kind === 'move') {
      const dm = (horizontal ? e.delta.x : e.delta.y) / ppm;
      place(d.job, snapTo(new Date(new Date(d.job.planned_start!).getTime() + dm * MIN), snap)); return;
    }
    const a = e.activatorEvent as MouseEvent | TouchEvent; const p = 'touches' in a ? a.touches[0] : a;
    const x = p.clientX + e.delta.x, y = p.clientY + e.delta.y; const r = trackRef.current?.getBoundingClientRect(); if (!r) return;
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return;
    const off = (horizontal ? x - r.left : y - r.top) / ppm;
    place(d.job, snapTo(new Date(dayStart.getTime() + off * MIN), snap));
  }
  const onStart = (e: DragStartEvent) => setDragging((e.active.data.current as { job: Job }).job);

  return (
    <DndContext sensors={sensors} onDragStart={onStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
      <div className="flex flex-col gap-3 p-3 md:flex-row">
        <aside className="md:w-64 md:shrink-0">
          <h2 className="mb-2 font-medium">Da programmare ({pending.length})</h2>
          <ul className="flex max-h-48 flex-col gap-2 overflow-y-auto md:max-h-[75vh]">
            {pending.map(j => <PendingItem key={j.id} job={j} color={colorOf(j)} onOpen={() => setEdit(j)} />)}
            {pending.length === 0 && <li className="text-sm opacity-60">Nessuna lavorazione da programmare.</li>}
          </ul>
        </aside>
        <main className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <button aria-label="Giorno precedente" className={btn} onClick={() => setDay(shiftDay(day, -1))}><ChevronLeft className="h-4 w-4" /></button>
            <button className={btn} onClick={() => setDay(todayStr())}>Oggi</button>
            <button aria-label="Giorno successivo" className={btn} onClick={() => setDay(shiftDay(day, 1))}><ChevronRight className="h-4 w-4" /></button>
            <input type="date" aria-label="Seleziona giorno" className={btn + ' bg-transparent'} value={day} onChange={e => e.target.value && setDay(e.target.value)} />
            <span className="text-sm font-medium capitalize">{format(parseISO(day), 'EEEE d MMMM yyyy', { locale: it })}</span>
            <span className="flex-1" />
            <select aria-label="Snap" className={btn + ' bg-transparent'} value={snap} onChange={e => { setSnap(+e.target.value); updSettings.mutate({ snap_minutes: +e.target.value }); }}>
              {[1, 5, 10, 15].map(s => <option key={s} value={s}>{s === 1 ? 'Al minuto' : `Snap ${s} min`}</option>)}</select>
            <button aria-label="Riduci zoom" className={btn} onClick={() => setZoom(z => Math.max(30, z / 1.25))}><ZoomOut className="h-4 w-4" /></button>
            <button aria-label="Aumenta zoom" className={btn} onClick={() => setZoom(z => Math.min(300, z * 1.25))}><ZoomIn className="h-4 w-4" /></button>
            <button className={btn} disabled={!undo.length} onClick={undoLast}><Undo2 className="inline h-4 w-4" /> Annulla</button>
          </div>
          {conflict && <ConflictPanel c={conflict} onUse={() => conflict.error.suggested_start && place(conflict.job, new Date(conflict.error.suggested_start))}
            onClose={() => setConflict(null)} />}
          {warn && <WarnPanel w={warn} onForce={() => place(warn.job, warn.start, true)} onClose={() => setWarn(null)} />}
          <div className="overflow-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" style={horizontal ? undefined : { height: '68vh' }}>
            <div ref={trackRef} className="relative select-none" style={horizontal ? { width: len, height: 150 } : { height: len }}>
              {zones.map((z, i) => <div key={'z' + i} aria-hidden className="pointer-events-none absolute bg-slate-400/15" style={span(z.a, z.b, 0, 0)}>
                {(z.b - z.a) * ppm > 70 && <span className={`absolute text-[10px] opacity-60 ${horizontal ? 'bottom-1 left-1' : 'right-2 top-1'}`}>{z.l}</span>}</div>)}
              {gaps.map((g, i) => <div key={'g' + i} aria-hidden className="pointer-events-none absolute flex items-center justify-center overflow-hidden rounded border border-dashed border-emerald-500/60 text-[10px] text-emerald-600" style={span(g.a, g.b, 28, 8)}>
                {(g.b - g.a) * ppm >= 56 && `libero ${fmtDuration(Math.round(g.b - g.a))}`}</div>)}
              {hourMarks(day, TZ).map(m => (
                <div key={m.min} className={horizontal ? 'absolute top-0 h-full border-l border-slate-200 pl-1 text-xs opacity-70 dark:border-slate-700' : 'absolute left-0 w-full border-t border-slate-200 pt-0.5 pl-1 text-xs opacity-70 dark:border-slate-700'}
                  style={horizontal ? { left: m.min * ppm } : { top: m.min * ppm }}>{m.label}</div>))}
              {visible.map(({ j, seg }) => <Block key={j.id} job={j} seg={seg!} color={colorOf(j)} horizontal={horizontal} ppm={ppm} hot={hot.has(j.id)} warn={av && (j.status === 'scheduled' || j.status === 'in_progress') ? checkStart(new Date(j.planned_start!), av.rules, av.exceptions) : []} onOpen={() => setEdit(j)} />)}
              {now >= dayStart && now.getTime() < dayStart.getTime() + minutes * MIN && (
                <div aria-label="Ora corrente" className="pointer-events-none absolute z-20 bg-red-500"
                  style={horizontal ? { left: ((now.getTime() - dayStart.getTime()) / MIN) * ppm, top: 0, bottom: 0, width: 2 }
                    : { top: ((now.getTime() - dayStart.getTime()) / MIN) * ppm, left: 0, right: 0, height: 2 }} />)}
            </div>
          </div>
        </main>
      </div>
      <DragOverlay>{dragging && !dragging.planned_start && <div className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white shadow-lg">{dragging.name} · {fmtDuration(dragging.duration_minutes)}</div>}</DragOverlay>
      {edit && <EditDialog job={edit} day={day} check={d => av ? checkStart(d, av.rules, av.exceptions) : []} onClose={() => setEdit(null)} onSave={s => place(edit, s)}
        onRemove={() => unschedule.mutate(edit, { onSuccess: () => setEdit(null), onError: e => alert((e as Error).message) })} />}
    </DndContext>
  );
}

function PendingItem({ job, color, onOpen }: { job: Job; color: string; onOpen: () => void }) {
  const { setNodeRef, listeners, attributes } = useDraggable({ id: 'new:' + job.id, data: { kind: 'new', job } });
  return (
    <li ref={setNodeRef} {...listeners} {...attributes} className="cursor-grab rounded-xl border border-slate-200 bg-white p-2 dark:border-slate-800 dark:bg-slate-900" style={{ borderLeft: `6px solid ${color}` }}>
      <p className="truncate text-sm font-medium">{job.name}</p>
      <p className="text-xs opacity-70">{fmtDuration(job.duration_minutes)}{job.optional ? ' · opzionale' : ''}</p>
      <div className="flex items-center justify-between">
        <span className="rounded-full px-2 py-0.5 text-xs text-white" style={{ background: PRIORITY_COLOR[job.priority] }}>{PRIORITY_LABEL[job.priority]}</span>
        <button className="text-xs underline" onPointerDown={e => e.stopPropagation()} onClick={onOpen}>Programma…</button>
      </div>
    </li>
  );
}

function Block({ job, seg, color, horizontal, ppm, hot, warn, onOpen }: { job: Job; seg: NonNullable<ReturnType<typeof segmentForDay>>; color: string; horizontal: boolean; ppm: number; hot: boolean; warn: string[]; onOpen: () => void }) {
  const { setNodeRef, listeners, attributes, transform, isDragging } = useDraggable({ id: 'move:' + job.id, data: { kind: 'move', job } });
  const pos = horizontal ? { left: seg.startMin * ppm, width: seg.durMin * ppm, top: 28, bottom: 8 } : { top: seg.startMin * ppm, height: seg.durMin * ppm, left: 56, right: 8 };
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} onClick={onOpen} title={`${job.name} ${fmtTime(job.planned_start!)}–${fmtTime(job.planned_end!)}${warn.length ? ' ⚠ ' + warn.join('; ') : ''}`}
      className={`absolute cursor-grab overflow-hidden px-2 py-1 text-xs text-white shadow ${hot ? 'ring-4 ring-red-500' : ''} ${warn.length ? 'outline outline-2 outline-amber-300' : ''} ${seg.continuesBefore ? '' : 'rounded-l-lg'} ${seg.continuesAfter ? '' : 'rounded-r-lg'}`}
      style={{ ...pos, background: color, borderTop: `5px solid ${PRIORITY_COLOR[job.priority]}`, zIndex: isDragging ? 30 : 1, opacity: isDragging ? 0.8 : job.status === 'completed' ? 0.6 : 1,
        transform: transform ? `translate3d(${transform.x}px,${transform.y}px,0)` : undefined }}>
      <p className="truncate font-semibold">{warn.length > 0 && <AlertTriangle aria-label="Avviso disponibilità" className="mr-1 inline h-3 w-3" />}{job.name}</p>
      <p className="truncate">{fmtTime(job.planned_start!)}–{fmtTime(job.planned_end!)} · {PRIORITY_LABEL[job.priority]}{job.status === 'completed' ? ' · ✓' : job.status === 'in_progress' ? ' · ▶' : ''}</p>
    </div>
  );
}

function ConflictPanel({ c, onUse, onClose }: { c: Conflict; onUse: () => void; onClose: () => void }) {
  const msg = c.error.error === 'conflict' ? null : new ScheduleError(c.error).message;
  return (
    <div role="alert" className="mb-2 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950 dark:text-red-100">
      <p className="font-medium">«{c.job.name}» non può iniziare alle {fmtTime(c.start)}: spostamento non applicato.</p>
      {msg && <p>{msg}</p>}
      {(c.error.conflicts ?? []).map((x: ConflictInfo) => (
        <p key={x.job_id}>• {x.reason === 'overlap' ? 'Si sovrappone a' : 'Non rispetta l\'intervallo minimo di cambio piatto rispetto a'} «{x.name}» ({fmtTime(x.planned_start)}–{fmtTime(x.planned_end)})</p>))}
      <div className="mt-2 flex gap-2">
        {c.error.suggested_start && <button className="rounded-lg bg-red-700 px-3 py-1.5 text-white" onClick={onUse}>Usa {fmtTime(c.error.suggested_start, TZ, 'dd/MM HH:mm')}</button>}
        <button className="rounded-lg px-3 py-1.5 underline" onClick={onClose}>Chiudi</button>
      </div>
    </div>
  );
}

function EditDialog({ job, day, check, onClose, onSave, onRemove }: { job: Job; day: string; check: (d: Date) => string[]; onClose: () => void; onSave: (s: Date) => void; onRemove: () => void }) {
  const [v, setV] = useState(job.planned_start ? toInputValue(job.planned_start) : `${day}T08:00`);
  const start = v ? fromInputValue(v, TZ) : null; const ok = !!start && !isNaN(start.getTime());
  return (
    <div role="dialog" aria-modal="true" aria-label="Orario di inizio" className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center">
      <div className="w-full max-w-sm space-y-3 rounded-t-2xl bg-white p-4 dark:bg-slate-900 sm:rounded-2xl">
        <h2 className="font-semibold">{job.name} · {fmtDuration(job.duration_minutes)}</h2>
        <label className="block text-sm">Inizio (Europe/Rome)
          <input type="datetime-local" className="w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-700" value={v} onChange={e => setV(e.target.value)} /></label>
        <p className="text-sm">Fine calcolata: <b>{ok ? fmtTime(computeEnd(start!, job.duration_minutes), TZ, 'dd/MM/yyyy HH:mm') : '—'}</b></p>
        {ok && check(start!).map(w => <p key={w} className="text-sm text-amber-600">⚠ {w}</p>)}
        <StatusActions job={job} onDone={onClose} />
        <div className="flex flex-wrap justify-end gap-2">
          {job.planned_start && <button className="mr-auto text-sm text-red-600 underline" onClick={onRemove}>Rimuovi dalla timeline</button>}
          <button className="rounded-lg px-3 py-2" onClick={onClose}>Chiudi</button>
          <button disabled={!ok} onClick={() => onSave(start!)} className="rounded-lg bg-slate-900 px-3 py-2 text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900">Salva</button>
        </div>
      </div>
    </div>
  );
}

function WarnPanel({ w, onForce, onClose }: { w: Warn; onForce: () => void; onClose: () => void }) {
  return (
    <div role="alert" className="mb-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
      <p className="font-medium">Avviso di disponibilità per «{w.job.name}»</p>
      {w.warnings.map(x => <p key={x}>• {x}</p>)}
      <div className="mt-2 flex gap-2">
        <button className="rounded-lg bg-amber-700 px-3 py-1.5 text-white" onClick={onForce}>Programma comunque</button>
        <button className="rounded-lg px-3 py-1.5 underline" onClick={onClose}>Annulla</button>
      </div>
    </div>
  );
}
