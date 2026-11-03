import { formatTime, indiaClock } from '../../../domain/time'
import {
  ATTENDANCE_LABEL, binRange, byClass, byProgramme, byStudent, classifyAll, dayLabel, exceptions, gateActivity, grainFor, insights, kpis, LATE_MIN, pct,
  RECORD_LABEL, series, SOURCE_LABEL, timeOf, type GroupLine, type Kpis, type StudentLine, type PeriodPoint, type ReportData, type Row,
} from '../engine'
import { byProgrammeOrder } from '../../admin/programmeGroups'

/** The school this app serves (the app has one center). */
export const CENTER = 'Jumpstart Preschool, Karve Road'

export interface Sections { kpis: boolean; charts: boolean; insights: boolean; exceptions: boolean; register: boolean; names: boolean; notes: boolean }
export const DEFAULT_SECTIONS: Sections = { kpis: true, charts: true, insights: true, exceptions: true, register: true, names: false, notes: false }

export interface Theme { name: string; series: readonly [string, string]; accent: string; ink: string }
/** Navy and teal (validated, CVD-safe on white); Monochrome prints well on any printer. */
export const THEMES: Record<'navy' | 'mono', Theme> = {
  navy: { name: 'Navy & teal', series: ['#3a5ea8', '#0f9488'], accent: '#1d3461', ink: '#16213b' },
  mono: { name: 'Monochrome (print)', series: ['#3d3d3d', '#9a9a9a'], accent: '#1f1f1f', ink: '#111111' },
}

export interface Tile { label: string; value: string; detail: string }
export interface Column { key: string; label: string; width: number; value: (r: Row) => string | number | null }

/** Everything any download shows, worked out once from the report's rows by the shared engine. */
export interface ReportDoc {
  reportId: string
  generatedAt: string
  center: string
  scope: string
  period: string
  cutoff: string
  rows: Row[]
  kpis: Kpis
  tiles: Tile[]
  points: PeriodPoint[]
  grainWord: string
  gate: ReturnType<typeof gateActivity>
  classes: ReturnType<typeof byClass>
  /** By main programme, in the school's order: each child in one, so the lines add up to the report. */
  programmes: GroupLine[]
  students: StudentLine[]
  insights: string[]
  exceptions: Row[]
  columns: Column[]
  sections: Sections
  theme: Theme
}

const at = (iso: string | null) => (iso ? formatTime(indiaClock(new Date(iso)).minutes) : '')
const shortSource = (s: Row['dropoff_source']) => (s === 'gate' ? 'Gate' : s === 'corrected' ? 'Corrected' : s === 'record' ? 'Not verified' : s === 'expired' ? 'Over 30 days' : '')

/** India date and time, "22 Oct 2026, 2:05 PM IST". */
export function stamp(iso: string): string {
  const c = indiaClock(new Date(iso))
  return `${dayLabel(c.date)}, ${formatTime(c.minutes)} IST`
}

export function columns(s: Sections): Column[] {
  const cols: Column[] = [
    { key: 'day', label: 'Date', width: 12, value: (r) => r.day },
    { key: 'child', label: 'Child', width: 22, value: (r) => r.child },
    { key: 'class', label: 'Class', width: 22, value: (r) => r.class },
    { key: 'attendance', label: 'Status', width: 12, value: (r) => ATTENDANCE_LABEL[r.attendance] },
    { key: 'record', label: 'Record', width: 12, value: (r) => RECORD_LABEL[r.record] },
    { key: 'sched_in', label: 'Scheduled arrival', width: 11, value: (r) => r.sched_in ?? '' },
    { key: 'dropoff', label: 'Drop-off', width: 10, value: (r) => at(r.dropoff_at) },
    { key: 'dropoff_source', label: 'Drop-off verification', width: 14, value: (r) => shortSource(r.dropoff_source) },
    { key: 'sched_out', label: 'Scheduled departure', width: 11, value: (r) => r.sched_out ?? '' },
    { key: 'announced', label: 'Parent announced pickup', width: 12, value: (r) => at(r.pickup_announced_at) },
    { key: 'ready', label: 'Child ready', width: 10, value: (r) => at(r.ready_at) },
    { key: 'pickup', label: 'Pickup', width: 10, value: (r) => at(r.pickup_at) },
    { key: 'pickup_source', label: 'Pickup verification', width: 14, value: (r) => shortSource(r.pickup_source) },
    { key: 'late_in', label: 'Late arrival (min)', width: 10, value: (r) => r.lateArrivalMin },
    { key: 'late_out', label: 'Late pickup (min)', width: 10, value: (r) => r.latePickupMin },
    { key: 'issues', label: 'Exceptions', width: 28, value: (r) => r.issues.join('; ') },
    { key: 'corrections', label: 'Corrections', width: 10, value: (r) => r.corrections.length || null },
  ]
  if (s.names) {
    cols.splice(9, 0, { key: 'dropoff_by', label: 'Checked in by', width: 16, value: (r) => r.dropoff_by ?? '' })
    cols.push({ key: 'pickup_to', label: 'Collected by', width: 18, value: (r) => r.pickup_to ?? '' }, { key: 'pickup_by', label: 'Handed over by', width: 16, value: (r) => r.pickup_by ?? '' })
  }
  if (s.notes) cols.push({ key: 'note', label: 'Note', width: 30, value: (r) => r.note ?? '' })
  return cols
}

export function buildDoc(o: { data: ReportData; reportId: string; generatedAt: string; scope: string; sections?: Sections; theme?: Theme }): ReportDoc {
  const sections = o.sections ?? DEFAULT_SECTIONS
  // Rows not due (marked off, or no programme and no record) never count anywhere.
  const rows = classifyAll(o.data, Date.parse(o.generatedAt)).filter((r) => r.attendance !== 'not_due')
  const k = kpis(rows)
  const grain = grainFor(o.data.from, o.data.cutoff)
  const all = o.data.cutoff >= o.data.from ? series(rows, o.data.from, o.data.cutoff, grain) : []
  // Day by day, only days the school was open for someone: a weekend or holiday is not a gap in the trend.
  const points = grain === 'day' ? all.filter((p) => p.due > 0 || p.dropoffs > 0 || p.pickups > 0) : all
  const n = (v: number) => v.toLocaleString('en-IN')
  const recorded = k.counts.present + k.counts.late + k.counts.absent
  const present = k.counts.present + k.counts.late
  const tiles: Tile[] = [
    { label: 'Attendance rate', value: pct(k.attendanceRate), detail: recorded ? `${n(present)} of ${n(recorded)} recorded days` : 'No recorded days' },
    { label: 'Verified drop-offs', value: n(k.verifiedDropoffs), detail: `${n(k.lateArrivals)} over ${LATE_MIN} min late` },
    { label: 'Verified pickups', value: n(k.verifiedPickups), detail: present ? `of ${n(present)} present days` : 'No present days' },
    { label: 'Late pickups', value: n(k.latePickups), detail: `Over ${LATE_MIN} min past schedule` },
    { label: 'Average arrival', value: timeOf(k.avgArrivalMin), detail: k.verifiedDropoffs ? `From ${n(k.verifiedDropoffs)} verified drop-offs` : 'No verified drop-offs' },
    { label: 'Incomplete records', value: n(k.incomplete), detail: `${n(k.notRecorded)} unrecorded · ${n(k.missingVerification)} unverified` },
  ]
  const period = o.data.from === o.data.to ? dayLabel(o.data.from) : `${dayLabel(o.data.from)} – ${dayLabel(o.data.to)}`
  return {
    reportId: o.reportId, generatedAt: o.generatedAt, center: CENTER, scope: o.scope, period,
    cutoff: `${dayLabel(o.data.cutoff)} (data read ${stamp(o.data.generated_at)})`,
    rows, kpis: k, tiles, points, grainWord: grain === 'day' ? 'Daily' : grain === 'week' ? 'Weekly' : 'Monthly',
    gate: gateActivity(rows), classes: byClass(rows), programmes: byProgramme(rows, byProgrammeOrder), students: byStudent(rows, byProgrammeOrder), insights: insights(rows, points), exceptions: exceptions(rows),
    columns: columns(sections), sections, theme: o.theme ?? THEMES.navy,
  }
}

export const busiestNote = (d: ReportDoc) => (d.gate.busiest ? `Busiest: ${binRange(d.gate.busiest)} (${d.gate.busiest.dropoffs + d.gate.busiest.pickups} events)` : 'No verified gate events')
export { SOURCE_LABEL }

// Spreadsheets and CSV ------------------------------------------------------------------------------------------------------

/**
 * Text a spreadsheet could take for a formula (= + - @, a tab or a carriage return at the start) gets a leading
 * apostrophe, so a child's name or a note can never run as a formula when a CSV is opened in Excel.
 */
export const safeCell = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v)

export function csv(d: ReportDoc): string {
  const q = (v: string | number | null) => (v === null ? '' : typeof v === 'number' ? String(v) : `"${safeCell(v).replace(/"/g, '""')}"`)
  const lines = [d.columns.map((c) => q(c.label)).join(',')]
  for (const r of d.rows) lines.push(d.columns.map((c) => q(c.value(r))).join(','))
  // A byte-order mark, so Excel reads the names' accents and scripts as UTF-8.
  return `﻿${lines.join('\r\n')}\r\n`
}
