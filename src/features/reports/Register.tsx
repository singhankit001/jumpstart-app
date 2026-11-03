import { useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Pencil } from '../../ui/icons'
import { Button } from '../../ui/Button'
import { SearchField, SelectField, TextField } from '../../ui/Field'
import { Pill, type Tone } from '../../ui/Pill'
import { Sheet, SheetFooter } from '../../ui/Sheet'
import { EmptyState, Notice } from '../../ui/States'
import { Switch } from '../../ui/Switch'
import { useToast } from '../../ui/Toast'
import { formatTime, indiaClock } from '../../domain/time'
import { correctAttendance, type Changes } from './api'
import { ATTENDANCE_LABEL, dayLabel, RECORD_LABEL, SOURCE_LABEL, type Attendance, type RecordState, type Row } from './engine'
import type { ReportDoc } from './exports/doc'

const PAGE = 25
const TONE: Record<Attendance, Tone> = { present: 'live', late: 'warning', absent: 'neutral', not_recorded: 'danger', expected: 'accent', not_due: 'neutral' }
const RECORD_TONE: Record<RecordState, Tone> = { complete: 'live', on_campus: 'accent', not_kept: 'neutral', incomplete: 'warning', none: 'neutral' }
const at = (iso: string | null) => (iso ? formatTime(indiaClock(new Date(iso)).minutes) : '—')

interface Col { key: string; label: string; sort: (r: Row) => string | number; render: (r: Row) => React.ReactNode; always?: boolean }
const COLS: Col[] = [
  { key: 'day', label: 'Date', sort: (r) => r.day, render: (r) => dayLabel(r.day), always: true },
  { key: 'child', label: 'Child', sort: (r) => r.child, render: (r) => <span className="font-bold">{r.child}</span>, always: true },
  { key: 'class', label: 'Class', sort: (r) => r.class, render: (r) => r.class },
  { key: 'status', label: 'Status', sort: (r) => r.attendance, render: (r) => <Pill tone={TONE[r.attendance]}>{ATTENDANCE_LABEL[r.attendance]}</Pill>, always: true },
  { key: 'record', label: 'Record', sort: (r) => r.record, render: (r) => (r.record === 'none' ? '—' : <Pill tone={RECORD_TONE[r.record]}>{RECORD_LABEL[r.record]}</Pill>) },
  { key: 'dropoff', label: 'Drop-off', sort: (r) => r.dropoffMin ?? -1, render: (r) => <Timed time={at(r.dropoff_at)} verified={r.dropoffVerified} late={r.lateArrivalMin} sched={r.sched_in} /> },
  { key: 'pickup', label: 'Pickup', sort: (r) => r.pickupMin ?? -1, render: (r) => <Timed time={at(r.pickup_at)} verified={r.pickupVerified} late={r.latePickupMin} sched={r.sched_out} /> },
  { key: 'announced', label: 'Parent announced', sort: (r) => r.pickup_announced_at ?? '', render: (r) => at(r.pickup_announced_at) },
  { key: 'issues', label: 'Exceptions', sort: (r) => r.issues.length, render: (r) => (r.issues.length ? <span className="text-warning">{r.issues.join('; ')}</span> : '—') },
]

function Timed({ time, verified, late, sched }: { time: string; verified: boolean; late: number | null; sched: string | null }) {
  if (time === '—') return <span className="text-ink-2">—</span>
  return (
    <span className="whitespace-nowrap">
      <span className="font-bold tabular-nums">{time}</span>
      <span className={`ml-1.5 text-caption font-bold ${verified ? 'text-live' : 'text-warning'}`}>{verified ? 'verified' : 'not verified'}</span>
      {late !== null && <span className="ml-1.5 text-caption font-bold text-warning">+{late} min</span>}
      {sched && <span className="block text-caption text-ink-2">scheduled {sched}</span>}
    </span>
  )
}

/** The register: every child-day in the period, searchable, filterable, sortable, a page at a time, each opening its detail. */
export function Register({ doc, canCorrect, onChanged }: { doc: ReportDoc; canCorrect: boolean; onChanged: () => void }) {
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<'' | Attendance>('')
  const [record, setRecord] = useState<'' | RecordState>('')
  const [onlyIssues, setOnlyIssues] = useState(false)
  const [hidden, setHidden] = useState<Set<string>>(new Set(['announced']))
  const [sort, setSort] = useState<{ key: string; desc: boolean }>({ key: 'day', desc: true })
  const [page, setPage] = useState(0)
  const [open, setOpen] = useState<Row | null>(null)

  const rows = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase('en-IN')
    const col = COLS.find((c) => c.key === sort.key)!
    return doc.rows
      .filter((r) => (!needle || [r.child, r.class].some((x) => x.toLocaleLowerCase('en-IN').includes(needle))) && (!status || r.attendance === status) && (!record || r.record === record) && (!onlyIssues || r.issues.length > 0))
      .sort((a, b) => {
        const x = col.sort(a)
        const y = col.sort(b)
        const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))
        return (sort.desc ? -c : c) || a.child.localeCompare(b.child)
      })
  }, [doc.rows, q, status, record, onlyIssues, sort])
  const pages = Math.max(1, Math.ceil(rows.length / PAGE))
  const shown = rows.slice(Math.min(page, pages - 1) * PAGE, (Math.min(page, pages - 1) + 1) * PAGE)
  const cols = COLS.filter((c) => !hidden.has(c.key))
  const reset = () => setPage(0)

  return (
    <div className="grid gap-4">
      <div className="card grid gap-3 rounded-xl p-4 md:grid-cols-[1.4fr_1fr_1fr_auto] md:items-end">
        <SearchField label="Find a child" placeholder="Child or class" value={q} onChange={(e) => { setQ(e.target.value); reset() }} />
        <SelectField label="Status" value={status} onValue={(v) => { setStatus(v as typeof status); reset() }}>
          <option value="">Any status</option>
          {(['present', 'late', 'absent', 'not_recorded', 'expected'] as const).map((s) => <option key={s} value={s}>{ATTENDANCE_LABEL[s]}</option>)}
        </SelectField>
        <SelectField label="Record" value={record} onValue={(v) => { setRecord(v as typeof record); reset() }}>
          <option value="">Any record</option>
          {(['complete', 'on_campus', 'incomplete', 'not_kept'] as const).map((s) => <option key={s} value={s}>{RECORD_LABEL[s]}</option>)}
        </SelectField>
        <label className="flex items-center gap-2 text-small font-bold text-ink-2">
          <Switch on={onlyIssues} label="Exceptions only" onChange={(v) => { setOnlyIssues(v); reset() }} />Exceptions only
        </label>
        <details className="md:col-span-4">
          <summary className="min-h-11 cursor-pointer py-2.5 text-small font-extrabold text-accent-ink">Columns</summary>
          <div className="mt-2 flex flex-wrap gap-2">
            {COLS.filter((c) => !c.always).map((c) => (
              <button key={c.key} type="button" className="choice min-h-11 px-3 py-1.5 text-caption font-bold" aria-pressed={!hidden.has(c.key)}
                onClick={() => setHidden((h) => { const n = new Set(h); if (n.has(c.key)) n.delete(c.key); else n.add(c.key); return n })}>{c.label}</button>
            ))}
          </div>
        </details>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No child-days match">Clear the search or a filter to see more.</EmptyState>
      ) : (
        <div className="card overflow-hidden rounded-xl">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-small">
              <caption className="sr-only">Attendance register, {rows.length} child-days, sorted by {COLS.find((c) => c.key === sort.key)?.label}</caption>
              <thead className="bg-sunken">
                <tr>
                  {cols.map((c) => (
                    <th key={c.key} scope="col" className="px-2 py-0 font-extrabold text-ink-2" aria-sort={sort.key === c.key ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
                      <button type="button" className="inline-flex min-h-11 items-center gap-1 px-2" onClick={() => setSort((s) => ({ key: c.key, desc: s.key === c.key ? !s.desc : false }))}>
                        {c.label}{sort.key === c.key && (sort.desc ? <ArrowDown className="size-3.5" aria-hidden /> : <ArrowUp className="size-3.5" aria-hidden />)}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {shown.map((r) => (
                  <tr key={`${r.child_id}-${r.day}`} className="cursor-pointer align-top hover:bg-sunken/60" onClick={() => setOpen(r)}>
                    {cols.map((c, i) => (
                      <td key={c.key} className="px-4 py-3">
                        {i === 1 ? <button type="button" className="text-left underline-offset-2 hover:underline" onClick={(e) => { e.stopPropagation(); setOpen(r) }}>{c.render(r)}</button> : c.render(r)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-small font-semibold text-ink-2">
            <span>{(Math.min(page, pages - 1) * PAGE + 1).toLocaleString('en-IN')}–{Math.min(rows.length, (Math.min(page, pages - 1) + 1) * PAGE).toLocaleString('en-IN')} of {rows.length.toLocaleString('en-IN')}</span>
            <span className="flex gap-2">
              <Button size="md" variant="secondary" icon={<ChevronLeft />} disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <Button size="md" variant="secondary" icon={<ChevronRight />} disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </span>
          </div>
        </div>
      )}
      <DaySheet key={open ? `${open.child_id}-${open.day}` : ''} row={open} canCorrect={canCorrect} onClose={() => setOpen(null)} onChanged={() => { setOpen(null); onChanged() }} />
    </div>
  )
}

/** One child-day: the schedule, each event in order with who did it, the record's verification and its corrections. */
function DaySheet({ row, canCorrect, onClose, onChanged }: { row: Row | null; canCorrect: boolean; onClose: () => void; onChanged: () => void }) {
  const [correcting, setCorrecting] = useState(false)
  if (!row) return null
  const events: Array<[string, string, string | null]> = [
    ['Drop-off', at(row.dropoff_at), row.dropoff_source ? `${SOURCE_LABEL[row.dropoff_source]}${row.dropoff_by ? ` · ${row.dropoff_by}` : ''}` : null],
    ['Parent said they were on the way', at(row.pickup_announced_at), 'Announcement, not attendance'],
    ['Parent arrived (said by the parent)', at(row.pickup_arrived_at), 'Announcement, not attendance'],
    ['Child ready at the gate', at(row.ready_at), null],
    ['Pickup', at(row.pickup_at), row.pickup_source ? `${SOURCE_LABEL[row.pickup_source]}${row.pickup_to ? ` · to ${row.pickup_to}` : ''}${row.pickup_by ? ` · by ${row.pickup_by}` : ''}` : null],
  ]
  return (
    <>
      {/* Hidden, not closed, while correcting: hiding a dialog fires its close event, which must not clear the row. */}
      <Sheet open={!!row && !correcting} onClose={() => { if (!correcting) onClose() }} title={row.child} description={`${dayLabel(row.day)} · ${row.class} · ${row.programme}`} wide>
        <div className="flex flex-wrap gap-2">
          <Pill tone={TONE[row.attendance]}>{ATTENDANCE_LABEL[row.attendance]}</Pill>
          {row.record !== 'none' && <Pill tone={RECORD_TONE[row.record]}>{RECORD_LABEL[row.record]}</Pill>}
          {row.marked && <Pill>Marked {row.marked.replace('_', ' ')}</Pill>}
        </div>
        <p className="mt-3 text-small font-semibold text-ink-2">Scheduled {row.sched_in ?? '—'} to {row.sched_out ?? '—'}{row.expected ? '' : ' · not a scheduled day'}</p>
        <ol className="mt-4 grid gap-2">
          {events.map(([what, when, how]) => (
            <li key={what} className={`grid grid-cols-[88px_1fr] gap-3 rounded-lg px-3 py-2.5 ${when === '—' ? 'bg-sunken/50 text-ink-2' : 'bg-sunken'}`}>
              <span className="font-extrabold tabular-nums">{when}</span>
              <span className="text-small"><span className="font-bold">{what}</span>{how && <span className="block text-caption font-semibold text-ink-2">{how}</span>}</span>
            </li>
          ))}
        </ol>
        {row.issues.length > 0 && <div className="mt-4"><Notice tone="warning">{row.issues.join('. ')}.</Notice></div>}
        {row.note && <p className="mt-3 text-small"><span className="font-bold">Note:</span> {row.note}</p>}
        {row.corrections.length > 0 && (
          <section className="mt-5">
            <h3 className="kicker mb-2">Corrections</h3>
            <ul className="grid gap-2 text-small">
              {row.corrections.map((c, i) => (
                <li key={i} className="rounded-lg border border-line px-3 py-2">
                  <span className="font-bold">{c.field}</span>: {c.old ?? 'empty'} → {c.new ?? 'empty'}
                  <span className="block text-caption text-ink-2">{c.reason} · {c.by ?? 'Someone'} · {new Date(c.at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        <SheetFooter>
          {canCorrect && <Button variant="secondary" icon={<Pencil />} onClick={() => setCorrecting(true)}>Correct this day</Button>}
          <Button onClick={onClose}>Done</Button>
        </SheetFooter>
      </Sheet>
      {correcting && <CorrectSheet row={row} onClose={() => setCorrecting(false)} onDone={() => { setCorrecting(false); onChanged() }} />}
    </>
  )
}

const timeOfIso = (iso: string | null) => (iso ? (() => { const m = indiaClock(new Date(iso)).minutes; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}` })() : '')
const isoOf = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00+05:30`).toISOString()

/** The admin's correction: only what changed is sent; a reason is required; the server keeps the old and new values. */
function CorrectSheet({ row, onClose, onDone }: { row: Row; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  // One request id per exact correction: a retry of the same one is safe, and an edited one is never taken for it.
  const ids = useRef(new Map<string, string>())
  const [status, setStatus] = useState<string>(row.marked ?? (row.dropoff_at || row.pickup_at ? 'present' : ''))
  const [dropoff, setDropoff] = useState(timeOfIso(row.dropoff_at))
  const [pickup, setPickup] = useState(timeOfIso(row.pickup_at))
  const [note, setNote] = useState(row.note ?? '')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const changes: Changes = {}
  if (status && status !== (row.marked ?? '')) changes.status = status as Changes['status']
  if (dropoff !== timeOfIso(row.dropoff_at)) changes.dropoff_at = dropoff ? isoOf(row.day, dropoff) : null
  if (pickup !== timeOfIso(row.pickup_at)) changes.pickup_at = pickup ? isoOf(row.day, pickup) : null
  if (note.trim() !== (row.note ?? '')) changes.note = note.trim() || null
  const nothing = Object.keys(changes).length === 0
  const shortReason = reason.trim().length < 3

  async function save() {
    setBusy(true)
    setError(null)
    const what = JSON.stringify([changes, reason.trim()])
    if (!ids.current.has(what)) ids.current.set(what, crypto.randomUUID())
    try {
      await correctAttendance(row.child_id, row.day, changes, reason.trim(), ids.current.get(what)!)
      toast('Correction saved. The old values are kept in its history.')
      onDone()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open onClose={onClose} title={`Correct ${row.child}`} description={`${dayLabel(row.day)}. Every change is kept with its reason, who made it and when.`}>
      <div className="grid gap-4">
        <SelectField label="Attendance" value={status} onValue={setStatus}>
          <option value="present">Present</option>
          <option value="absent">Absent</option>
          <option value="on_leave">On leave</option>
          <option value="off">Not due (no school for this child)</option>
        </SelectField>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Drop-off time (IST)" type="time" value={dropoff} onChange={(e) => setDropoff(e.target.value)} hint="Empty clears it" />
          <TextField label="Pickup time (IST)" type="time" value={pickup} onChange={(e) => setPickup(e.target.value)} hint="Empty clears it" />
        </div>
        <TextField label="Note (optional)" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        <TextField label="Reason for the correction" value={reason} maxLength={300} required onChange={(e) => setReason(e.target.value)}
          hint="Required. For example: the gate tablet was offline at drop-off." error={reason && shortReason ? 'At least 3 characters.' : null} />
        {error && <Notice tone="danger">{error}</Notice>}
      </div>
      <SheetFooter>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button loading={busy} disabled={nothing || shortReason} onClick={() => void save()}>Save correction</Button>
      </SheetFooter>
    </Sheet>
  )
}
