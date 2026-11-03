import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BarChart3, CalendarDays, Download, GraduationCap, ListChecks, TriangleAlert } from 'lucide-react'
import { AreaShell } from '../auth/AreaShell'
import { useSession } from '../auth/session'
import { Tabs } from '../../ui/Tabs'
import { DateField } from '../../ui/DateField'
import { SelectField } from '../../ui/Field'
import { EmptyState, ErrorState, Notice, SkeletonList } from '../../ui/States'
import { addDays } from '../../ui/RangeCalendar'
import { todayInIndia } from '../trips/api'
import { loadOptions, loadReport, type Filters, type Option, type Student } from './api'
import { barChart, lineChart } from './charts'
import { BarList, Chart } from './ChartCards'
import { binRange, dayLabel, pct, ATTENDANCE_LABEL, type ReportData, type Row } from './engine'
import { buildDoc, type ReportDoc } from './exports/doc'
import { StudentGroups, type Group } from './ClassList'
import { groupByProgramme } from '../admin/programmeGroups'
import { Register } from './Register'
import { Studio } from './Studio'

type Tab = 'classes' | 'overview' | 'register' | 'downloads'
type Preset = 'today' | 'week' | 'month' | '30' | 'custom'
const PRESETS: Array<{ key: Preset; label: string }> = [
  { key: 'today', label: 'Today' }, { key: 'week', label: 'This week' }, { key: 'month', label: 'This month' }, { key: '30', label: 'Last 30 days' }, { key: 'custom', label: 'Custom' },
]

function rangeOf(p: Preset, today: string): { from: string; to: string } | null {
  if (p === 'today') return { from: today, to: today }
  if (p === 'week') { const wd = new Date(`${today}T00:00:00Z`).getUTCDay() || 7; return { from: addDays(today, 1 - wd), to: today } }
  if (p === 'month') return { from: `${today.slice(0, 7)}-01`, to: today }
  if (p === '30') return { from: addDays(today, -29), to: today }
  return null
}

/** Attendance & Reports for the admin, Head office and the gate roles: students by class, the analytics, the register and the downloads, from one dataset. */
export function ReportsPage({ area }: { area: 'admin' | 'core' | 'coordinator' }) {
  const { state } = useSession()
  const canCorrect = state.status === 'signed-in' && !!state.me?.roles.includes('admin')
  const today = todayInIndia()
  const [tab, setTab] = useState<Tab>('classes')
  const [groupBy, setGroupBy] = useState<'class' | 'programme'>('class')
  const [preset, setPreset] = useState<Preset>('month')
  const [range, setRange] = useState(() => rangeOf('month', today)!)
  const [programmeId, setProgrammeId] = useState('')
  const [options, setOptions] = useState<{ classes: Option[]; programmes: Option[]; students: Student[] } | null>(null)
  const [optionsFailed, setOptionsFailed] = useState(false)
  // With the filters it was read for: after a correction the same report is read again behind the current one.
  const [read, setRead] = useState<{ key: string; data: ReportData } | null>(null)
  const latest = useRef(0)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const filters: Filters = useMemo(() => ({ from: range.from, to: range.to, classId: null, programmeId: programmeId || null, childId: null }), [range, programmeId])
  const scope = ['All classes', programmeId ? options?.programmes.find((p) => p.id === programmeId)?.name : 'all programmes'].filter(Boolean).join(' · ')

  const key = JSON.stringify(filters)
  const load = useCallback(() => {
    // Only the latest read counts: an earlier, slower one must not show another class's or period's figures.
    const mine = ++latest.current
    setLoading(true)
    setError(null)
    loadReport(filters).then(
      (d) => { if (mine === latest.current) { setRead({ key: JSON.stringify(filters), data: d }); setLoading(false) } },
      (e: Error) => { if (mine === latest.current) { setError(e.message); setLoading(false) } },
    )
  }, [filters])
  useEffect(load, [load])
  const loadLists = useCallback(() => {
    setOptionsFailed(false)
    void loadOptions().then(setOptions, () => { setOptions({ classes: [], programmes: [], students: [] }); setOptionsFailed(true) })
  }, [])
  useEffect(loadLists, [loadLists])
  const data = read?.data ?? null
  // A different period, class or programme shows the skeleton; the same one read again keeps the page (and the
  // register's search, filters and page) in place.
  const reading = loading && read?.key !== key

  // The dashboard's figures come from the same document builder as every download.
  const doc = useMemo(() => (data ? buildDoc({ data, reportId: '', generatedAt: data.generated_at, scope }) : null), [data, scope])

  // With a programme chosen, only its students (by main programme, or anyone with a row in it as an extra one).
  const inScope = useMemo(() => {
    const all = options?.students ?? []
    if (!programmeId || !doc) return all
    const seen = new Set(doc.rows.map((r) => r.child_id))
    return all.filter((s) => s.programme_id === programmeId || seen.has(s.id))
  }, [options, programmeId, doc])
  const classGroups: Group[] = (options?.classes ?? []).map((c) => ({ id: c.id, name: c.name, kids: inScope.filter((s) => s.class_id === c.id) }))
  const programmeGroups: Group[] = groupByProgramme(inScope, options?.programmes ?? [], (s) => s.programme_id, (s) => s.full_name).map((g) => ({ id: g.id, name: g.name, kids: g.items }))

  const pick = (p: Preset) => { setPreset(p); const r = rangeOf(p, today); if (r) setRange(r) }

  return (
    <AreaShell area={area} title="Attendance & Reports" subtitle="Verified drop-offs and pickups, attendance and exceptions. Times are India Standard Time.">
      <section className="card mt-6 grid gap-4 rounded-xl p-4 sm:p-5" aria-label="Filters">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Period">
          {PRESETS.map((p) => (
            <button key={p.key} type="button" className="choice min-h-11 px-4 py-2 text-small font-bold" aria-pressed={preset === p.key} onClick={() => pick(p.key)}>{p.label}</button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {preset === 'custom' && (
            <>
              <DateField label="From" value={range.from} max={range.to} onChange={(from) => setRange((r) => ({ from, to: r.to < from ? from : r.to }))} />
              <DateField label="To" value={range.to} min={range.from} max={today} onChange={(to) => setRange((r) => ({ from: r.from > to ? to : r.from, to }))} />
            </>
          )}
          <SelectField label="Programme" value={programmeId} onValue={setProgrammeId}>
            <option value="">All programmes</option>
            {options?.programmes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </SelectField>
        </div>
        {optionsFailed && (
          <Notice tone="warning">
            Couldn't load the classes, students and programmes, so students can't be shown by class or programme.{' '}
            <button type="button" className="inline-flex min-h-11 items-center font-extrabold text-accent-ink underline underline-offset-2" onClick={loadLists}>Try again</button>
          </Notice>
        )}
        <p className="flex items-center gap-2 text-caption font-semibold text-ink-2">
          <CalendarDays className="size-4" aria-hidden />
          {range.from === range.to ? dayLabel(range.from) : `${dayLabel(range.from)} – ${dayLabel(range.to)}`} · {scope}
          {data && !reading && <span className="text-ink-2"> · {loading ? 'updating…' : `read at ${new Date(data.generated_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })}`}</span>}
        </p>
      </section>

      <div className="mt-6">
        <Tabs id="reports" label="Reports" value={tab} onChange={setTab} items={[
          { key: 'classes', label: 'Students', icon: <GraduationCap /> },
          { key: 'overview', label: 'Overview', icon: <BarChart3 /> },
          { key: 'register', label: 'Register', icon: <ListChecks />, count: doc?.exceptions.length || null },
          { key: 'downloads', label: 'Downloads', icon: <Download /> },
        ]} />
      </div>

      <div id="reports-panel" role="tabpanel" aria-labelledby={`reports-${tab}`} className="mt-5" aria-busy={loading}>
        {error ? <ErrorState title="Couldn't load attendance" onRetry={load}>{error}</ErrorState>
          : !doc || reading ? <SkeletonList count={6} className="grid gap-3 md:grid-cols-3" height="h-[120px]" />
          : tab === 'classes' ? (
            <div className="grid gap-3">
              <div className="flex flex-wrap gap-2" role="group" aria-label="Group students">
                {(['class', 'programme'] as const).map((g) => (
                  <button key={g} type="button" className="choice min-h-11 px-4 py-2 text-small font-bold" aria-pressed={groupBy === g} onClick={() => setGroupBy(g)}>By {g}</button>
                ))}
              </div>
              <StudentGroups key={groupBy} noun={groupBy} groups={groupBy === 'class' ? classGroups : programmeGroups} rows={doc.rows} oneDay={range.from === range.to} />
            </div>
          )
          : tab === 'overview' ? <Overview doc={doc} today={today} onOpen={() => setTab('register')} />
          : tab === 'register' ? <Register doc={doc} canCorrect={canCorrect} onChanged={load} />
          : <Studio filters={filters} scope={scope} rows={doc.rows} />}
      </div>
    </AreaShell>
  )
}

function Overview({ doc, today, onOpen }: { doc: ReportDoc; today: string; onOpen: () => void }) {
  if (!doc.rows.length) {
    return <EmptyState title="No attendance in this period">No child was expected and nothing was recorded. Choose another period, class or programme.</EmptyState>
  }
  const cats = doc.points.map((p) => p.label)
  const todayRows = doc.rows.filter((r) => r.day === today)
  const gate = doc.gate
  const hours = gate.bins.map((b) => (b.from % 120 === 0 ? b.label.replace(':00', '') : ''))
  const n = (v: number) => v.toLocaleString('en-IN')
  const fmtCount = (v: number | null) => (v === null ? '—' : n(v))
  const statusItems = (['present', 'late', 'absent', 'not_recorded', 'expected'] as const).map((s) => ({ label: ATTENDANCE_LABEL[s], value: doc.rows.filter((r) => r.attendance === s).length }))
  return (
    <div className="grid gap-5">
      {todayRows.length > 0 && <TodayStrip rows={todayRows} />}
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" aria-label="Key figures">
        {doc.tiles.map((t) => (
          <li key={t.label} className="card rounded-xl p-4">
            <p className="kicker">{t.label}</p>
            <p className="mt-1 text-[28px] font-extrabold leading-tight tracking-[-0.02em] tabular-nums">{t.value}</p>
            <p className="text-caption font-semibold text-ink-2">{t.detail}</p>
          </li>
        ))}
      </ul>
      <section className="card rounded-xl p-5" aria-labelledby="insights-t">
        <h3 id="insights-t" className="text-h4">What the data shows</h3>
        <ul className="mt-2 grid list-disc gap-1.5 pl-5 text-body marker:text-accent">
          {(doc.insights.length ? doc.insights : ['Not enough recorded data in this period for an observation.']).map((i) => <li key={i}>{i}</li>)}
        </ul>
      </section>
      <div className="grid gap-5 lg:grid-cols-2">
        <Chart title="Attendance trend" subtitle={`${doc.grainWord} attendance rate: present and late of recorded child-days`}
          build={(box) => lineChart({ box, categories: cats, values: doc.points.map((p) => p.rate) })} categories={cats} seriesNames={['Attendance rate']}
          values={[doc.points.map((p) => p.rate)]} format={(v) => pct(v)} empty={doc.points.some((p) => p.rate !== null) ? null : 'No recorded attendance in this period.'} />
        <Chart title="Verified pickups and drop-offs" subtitle={`${doc.grainWord}, by the gate or an admin's correction`}
          build={(box) => barChart({ box, categories: cats, series: [doc.points.map((p) => p.dropoffs), doc.points.map((p) => p.pickups)] })} categories={cats}
          seriesNames={['Drop-offs', 'Pickups']} values={[doc.points.map((p) => p.dropoffs), doc.points.map((p) => p.pickups)]} format={fmtCount}
          empty={doc.kpis.verifiedDropoffs + doc.kpis.verifiedPickups ? null : 'No verified drop-offs or pickups yet.'} />
        <Chart title="Peak gate activity" subtitle="Verified events per 30 minutes, IST"
          build={(box) => { const m = barChart({ box, categories: hours, series: [gate.bins.map((b) => b.dropoffs), gate.bins.map((b) => b.pickups)], stacked: true, maxLabels: gate.bins.length }); m.xLabels = m.xLabels.filter((l) => l.label); return m }}
          categories={gate.bins.map((b) => binRange(b))} seriesNames={['Arrivals', 'Departures']} values={[gate.bins.map((b) => b.dropoffs), gate.bins.map((b) => b.pickups)]} format={fmtCount}
          note={gate.busiest ? `Busiest: ${binRange(gate.busiest)}, ${gate.busiest.dropoffs + gate.busiest.pickups} events.` : null} empty={gate.busiest ? null : 'No verified gate events yet.'} />
        <BarList title="Attendance status" subtitle="Child-days in this period" items={statusItems} format={fmtCount} />
        <BarList title="Classes compared" subtitle="Attendance rate by class (the school has one center)" items={doc.classes.map((c) => ({ label: c.name, value: c.rate, max: 1, detail: `${c.present}/${c.due}` }))}
          format={(v) => pct(v)} empty={doc.classes.length ? null : 'No classes in this selection.'} />
        <Chart title="Late pickups" subtitle={`${doc.grainWord}, more than 10 minutes after the scheduled time`}
          build={(box) => barChart({ box, categories: cats, series: [doc.points.map((p) => p.latePickups)] })} categories={cats} seriesNames={['Late pickups']}
          values={[doc.points.map((p) => p.latePickups)]} format={fmtCount} empty={doc.kpis.verifiedPickups ? null : 'No verified pickups yet.'} />
        <Chart title="Missing records" subtitle={`${doc.grainWord}: no record, and present without a verified drop-off or pickup`}
          build={(box) => barChart({ box, categories: cats, series: [doc.points.map((p) => p.notRecorded), doc.points.map((p) => p.missingVerification)], stacked: true })}
          categories={cats} seriesNames={['No record', 'Not verified']} values={[doc.points.map((p) => p.notRecorded), doc.points.map((p) => p.missingVerification)]} format={fmtCount}
          note={doc.kpis.incomplete === 0 ? 'Every expected child-day has a complete record.' : null} />
      </div>
      {doc.exceptions.length > 0 && (
        <section className="card rounded-xl p-5" aria-labelledby="exc-t">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="exc-t" className="flex items-center gap-2 text-h4"><TriangleAlert className="size-5 text-warning" aria-hidden />Needs attention</h3>
            <button type="button" className="inline-flex min-h-11 items-center text-small font-extrabold text-accent-ink underline" onClick={onOpen}>Open the register</button>
          </div>
          <ul className="mt-3 divide-y divide-line">
            {doc.exceptions.slice(0, 8).map((r) => (
              <li key={`${r.child_id}-${r.day}`} className="flex flex-wrap justify-between gap-x-4 py-2 text-small">
                <span className="font-bold">{r.child} <span className="font-semibold text-ink-2">· {r.class}</span></span>
                <span className="text-ink-2">{dayLabel(r.day)} · {r.issues.join('; ')}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <Notice tone="info">
        Verified means the gate's Check in or Hand over, or an admin's correction. A parent's "On my way" or "I've arrived" is an announcement and never counts as attendance.
      </Notice>
    </div>
  )
}

function TodayStrip({ rows }: { rows: Row[] }) {
  const items: Array<[string, number]> = [
    ['On campus now', rows.filter((r) => r.record === 'on_campus').length],
    ['Dropped off', rows.filter((r) => r.dropoffVerified).length],
    ['Collected', rows.filter((r) => r.pickupVerified).length],
    ['Expected, not yet in', rows.filter((r) => r.attendance === 'expected').length],
    ['Absent', rows.filter((r) => r.attendance === 'absent').length],
  ]
  return (
    <section className="card rounded-xl p-5" aria-labelledby="today-t">
      <h3 id="today-t" className="text-h4">Today</h3>
      <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {items.map(([label, v]) => (
          <li key={label} className="rounded-lg bg-sunken px-4 py-3">
            <p className="text-[24px] font-extrabold leading-none tabular-nums">{v}</p>
            <p className="mt-1 text-caption font-bold text-ink-2">{label}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}
