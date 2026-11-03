import { formatTime, indiaClock, toMinutes, weekdayOf, type Minutes } from '../../domain/time'
import { LATE_THRESHOLD_MIN } from '../../domain/lateness'
import { byClassOrder } from '../../domain/programme'

/**
 * The reporting engine: the one place attendance statuses, every KPI, every chart series, the insights and the
 * exceptions are worked out, from the rows attendance_report (0062) returns. The dashboard, the register and every
 * download (PDF, Excel, Word, CSV) call these functions on the same rows, so they can never disagree.
 *
 * Verified means a staff action: the gate's Check in or Hand over ('gate'), or an admin's correction with a reason
 * ('corrected'). A time from an older record with neither ('record') counts as present, never as verified. Trips are
 * deleted after 30 days, so a time from before then without a correction ('expired') is neither: its record is 'not kept'
 * rather than incomplete, and it can't be late. A parent's
 * "on my way", "I've arrived" and the gate's Ready are announcements, never proof that a child came or left.
 */

export type Source = 'gate' | 'corrected' | 'record' | 'expired'
export interface Correction { field: string; old: string | null; new: string | null; reason: string; by: string | null; at: string }
export interface RawRow {
  child_id: string
  child: string
  class: string
  class_id: string
  programme: string
  day: string
  expected: boolean
  sched_in: string | null
  sched_out: string | null
  marked: 'present' | 'absent' | 'on_leave' | 'off' | null
  note: string | null
  dropoff_at: string | null
  pickup_at: string | null
  dropoff_source: Source | null
  pickup_source: Source | null
  dropoff_by: string | null
  pickup_by: string | null
  pickup_to: string | null
  dropoff_announced_at: string | null
  pickup_announced_at: string | null
  pickup_arrived_at: string | null
  ready_at: string | null
  corrections: Correction[]
}
export interface ReportData {
  generated_at: string
  from: string
  to: string
  cutoff: string
  today: string
  timezone: string
  /** The first day whose gate details (trips) are still kept. */
  verification_from: string
  holidays: Array<{ day: string; name: string }>
  rows: RawRow[]
}

/** Attendance: Present, Late (a verified drop-off after the scheduled arrival plus the threshold), Absent (marked absent or on leave), Not recorded (expected, nothing at all), Expected (today, not yet due), Not due (marked off). */
export type Attendance = 'present' | 'late' | 'absent' | 'not_recorded' | 'expected' | 'not_due'
/** The day's verification, apart from attendance: Complete (drop-off and pickup both verified), On campus (today, dropped off, not yet collected), Not kept (a time from before the 30 days gate details are kept), Incomplete (present, but a verified drop-off or pickup is missing), None (not present). */
export type RecordState = 'complete' | 'on_campus' | 'not_kept' | 'incomplete' | 'none'

export interface Row extends RawRow {
  attendance: Attendance
  record: RecordState
  dropoffVerified: boolean
  pickupVerified: boolean
  /** Minutes in India time, or null. */
  dropoffMin: Minutes | null
  pickupMin: Minutes | null
  /** Minutes past the scheduled time plus the threshold; null when on time or not verified. */
  lateArrivalMin: number | null
  latePickupMin: number | null
  issues: string[]
}

/** Minutes after the scheduled time before an arrival or a pickup counts as late (the app's running-late threshold). */
export const LATE_MIN = LATE_THRESHOLD_MIN

const verified = (s: Source | null) => s === 'gate' || s === 'corrected'
const minutesOf = (iso: string | null): Minutes | null => (iso ? indiaClock(new Date(iso)).minutes : null)
const hhmm = (s: string | null): Minutes | null => { try { return s ? toMinutes(s) : null } catch { return null } }

/** One row's statuses, from its facts and the moment the data was read (nowMs). */
export function classify(r: RawRow, nowMs: number, today: string): Row {
  const dropoffVerified = verified(r.dropoff_source)
  const pickupVerified = verified(r.pickup_source)
  const dropoffMin = minutesOf(r.dropoff_at)
  const pickupMin = minutesOf(r.pickup_at)
  const schedIn = hhmm(r.sched_in)
  const schedOut = hhmm(r.sched_out)
  const lateArrivalMin = dropoffVerified && dropoffMin !== null && schedIn !== null && dropoffMin > schedIn + LATE_MIN ? dropoffMin - schedIn : null
  const latePickupMin = pickupVerified && pickupMin !== null && schedOut !== null && pickupMin > schedOut + LATE_MIN ? pickupMin - schedOut : null
  const isToday = r.day === today
  const nowMin = indiaClock(new Date(nowMs)).minutes
  const came = r.marked === 'present' || r.dropoff_at !== null || r.pickup_at !== null

  let attendance: Attendance
  if (r.marked === 'off' || (!r.expected && !came && r.marked === null)) attendance = 'not_due'
  else if (r.marked === 'absent' || r.marked === 'on_leave') attendance = 'absent'
  else if (came) attendance = lateArrivalMin !== null ? 'late' : 'present'
  else if (isToday && (schedOut === null || nowMin < schedOut)) attendance = 'expected'
  else attendance = 'not_recorded'

  let record: RecordState = 'none'
  if (attendance === 'present' || attendance === 'late') {
    if (dropoffVerified && pickupVerified) record = 'complete'
    else if (isToday && dropoffVerified && r.pickup_at === null) record = 'on_campus'
    else if (r.dropoff_source === 'expired' || r.pickup_source === 'expired') record = 'not_kept'
    else record = 'incomplete'
  }

  const issues: string[] = []
  if (attendance === 'not_recorded') issues.push('No attendance record')
  if (record === 'incomplete') {
    if (!dropoffVerified) issues.push(r.dropoff_at ? 'Drop-off not verified' : 'No drop-off recorded')
    if (!pickupVerified) issues.push(r.pickup_at ? 'Pickup not verified' : 'No pickup recorded')
  }
  if (latePickupMin !== null) issues.push(`Late pickup (${latePickupMin} min)`)
  return { ...r, attendance, record, dropoffVerified, pickupVerified, dropoffMin, pickupMin, lateArrivalMin, latePickupMin, issues }
}

export function classifyAll(data: ReportData, nowMs: number): Row[] {
  return data.rows.map((r) => classify(r, nowMs, data.today))
}

// KPIs ------------------------------------------------------------------------------------------------------------------

export interface Counts { present: number; late: number; absent: number; notRecorded: number; expected: number; notDue: number }
export function counts(rows: readonly Row[]): Counts {
  const c: Counts = { present: 0, late: 0, absent: 0, notRecorded: 0, expected: 0, notDue: 0 }
  for (const r of rows) {
    if (r.attendance === 'present') c.present++
    else if (r.attendance === 'late') c.late++
    else if (r.attendance === 'absent') c.absent++
    else if (r.attendance === 'not_recorded') c.notRecorded++
    else if (r.attendance === 'expected') c.expected++
    else c.notDue++
  }
  return c
}

/** (Present + Late) / (Present + Late + Absent): of the child-days with a record. Null when there are none. */
export const attendanceRate = (c: Counts): number | null => {
  const d = c.present + c.late + c.absent
  return d === 0 ? null : (c.present + c.late) / d
}

export interface Kpis {
  /** (Present + Late) / (Present + Late + Absent). */
  attendanceRate: number | null
  /** Recorded child-days / child-days that were due (Present + Late + Absent + Not recorded). */
  coverage: number | null
  /** Child-days with a drop-off by the gate or an admin's correction. */
  verifiedDropoffs: number
  /** Child-days with a pickup by the gate (to a registered guardian or a collector with their code) or an admin's correction. */
  verifiedPickups: number
  /** Verified pickups more than LATE_MIN minutes after the scheduled departure. */
  latePickups: number
  /** Verified drop-offs more than LATE_MIN minutes after the scheduled arrival. */
  lateArrivals: number
  /** Mean time of day of verified drop-offs, in India time. Null with none. */
  avgArrivalMin: number | null
  /** Not recorded + Incomplete (present without a verified drop-off or pickup). */
  incomplete: number
  notRecorded: number
  missingVerification: number
  /** Present child-days from before the 30 days gate details are kept: neither verified nor incomplete. */
  notKept: number
  /** Today: dropped off and not yet collected. */
  onCampus: number
  counts: Counts
}

export function kpis(rows: readonly Row[]): Kpis {
  const c = counts(rows)
  const due = c.present + c.late + c.absent + c.notRecorded
  const arrivals = rows.filter((r) => r.dropoffVerified && r.dropoffMin !== null).map((r) => r.dropoffMin!)
  const missingVerification = rows.filter((r) => r.record === 'incomplete').length
  return {
    attendanceRate: attendanceRate(c),
    coverage: due === 0 ? null : (c.present + c.late + c.absent) / due,
    verifiedDropoffs: rows.filter((r) => r.dropoffVerified).length,
    verifiedPickups: rows.filter((r) => r.pickupVerified).length,
    latePickups: rows.filter((r) => r.latePickupMin !== null).length,
    lateArrivals: rows.filter((r) => r.lateArrivalMin !== null).length,
    avgArrivalMin: arrivals.length ? Math.round(arrivals.reduce((a, b) => a + b, 0) / arrivals.length) : null,
    incomplete: c.notRecorded + missingVerification,
    notRecorded: c.notRecorded,
    missingVerification,
    notKept: rows.filter((r) => r.record === 'not_kept').length,
    onCampus: rows.filter((r) => r.record === 'on_campus').length,
    counts: c,
  }
}

// Periods ---------------------------------------------------------------------------------------------------------------

export type Grain = 'day' | 'week' | 'month'
/** Days up to a month, weeks up to four months, months beyond: enough points to read, few enough to label. */
export function grainFor(from: string, to: string): Grain {
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1
  return days <= 31 ? 'day' : days <= 120 ? 'week' : 'month'
}
/** The period a day belongs to: itself, its week's Monday, or its month's first day. */
export function periodOf(day: string, grain: Grain): string {
  if (grain === 'day') return day
  if (grain === 'month') return `${day.slice(0, 7)}-01`
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - (weekdayOf(day) - 1))
  return d.toISOString().slice(0, 10)
}
/** Every period from `from` to `to`, so a closed week or a holiday shows as a gap, never disappears. */
export function periods(from: string, to: string, grain: Grain): string[] {
  const out: string[] = []
  for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    const p = periodOf(d.toISOString().slice(0, 10), grain)
    if (out[out.length - 1] !== p) out.push(p)
  }
  return out
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "2 Mar", "w/c 2 Mar", "Mar 2026". */
export function periodLabel(p: string, grain: Grain): string {
  const [y, m, d] = p.split('-').map(Number) as [number, number, number]
  if (grain === 'month') return `${MONTHS[m - 1]} ${y}`
  return `${grain === 'week' ? 'w/c ' : ''}${d} ${MONTHS[m - 1]}`
}
export const dayLabel = (day: string) => {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  return `${d} ${MONTHS[m - 1]} ${y}`
}

export interface PeriodPoint {
  period: string
  label: string
  /** Null when nobody was due (a holiday, a weekend, a closed week): a gap, never a zero. */
  rate: number | null
  dropoffs: number
  pickups: number
  latePickups: number
  lateArrivals: number
  notRecorded: number
  missingVerification: number
  due: number
}

export function series(rows: readonly Row[], from: string, to: string, grain: Grain = grainFor(from, to)): PeriodPoint[] {
  const by = new Map<string, Row[]>()
  for (const r of rows) {
    const p = periodOf(r.day, grain)
    by.set(p, [...(by.get(p) ?? []), r])
  }
  return periods(from, to, grain).map((p) => {
    const list = by.get(p) ?? []
    const c = counts(list)
    return {
      period: p, label: periodLabel(p, grain), rate: attendanceRate(c),
      dropoffs: list.filter((r) => r.dropoffVerified).length,
      pickups: list.filter((r) => r.pickupVerified).length,
      latePickups: list.filter((r) => r.latePickupMin !== null).length,
      lateArrivals: list.filter((r) => r.lateArrivalMin !== null).length,
      notRecorded: c.notRecorded,
      missingVerification: list.filter((r) => r.record === 'incomplete').length,
      due: c.present + c.late + c.absent + c.notRecorded,
    }
  })
}

// Gate activity -----------------------------------------------------------------------------------------------------------

export const BIN_MIN = 30
export const GATE_FROM: Minutes = 7 * 60
export const GATE_TO: Minutes = 20 * 60
export interface Bin { from: Minutes; label: string; dropoffs: number; pickups: number }
/** Verified drop-offs and pickups by half hour of the day (India time), 07:00 to 20:00. Times outside go to the end bins. */
export function gateActivity(rows: readonly Row[]): { bins: Bin[]; busiest: Bin | null } {
  const bins: Bin[] = []
  for (let m = GATE_FROM; m < GATE_TO; m += BIN_MIN) bins.push({ from: m, label: formatTime(m), dropoffs: 0, pickups: 0 })
  const at = (min: Minutes) => bins[Math.min(bins.length - 1, Math.max(0, Math.floor((min - GATE_FROM) / BIN_MIN)))]!
  for (const r of rows) {
    if (r.dropoffVerified && r.dropoffMin !== null) at(r.dropoffMin).dropoffs++
    if (r.pickupVerified && r.pickupMin !== null) at(r.pickupMin).pickups++
  }
  let busiest: Bin | null = null
  for (const b of bins) if (b.dropoffs + b.pickups > 0 && (!busiest || b.dropoffs + b.pickups > busiest.dropoffs + busiest.pickups)) busiest = b
  return { bins, busiest }
}
export const binRange = (b: Bin) => `${formatTime(b.from)}–${formatTime(b.from + BIN_MIN)}`

// Classes -----------------------------------------------------------------------------------------------------------------

export interface ClassLine { classId: string; name: string; rate: number | null; present: number; due: number; latePickups: number; incomplete: number }
/** The school has one center: classes (each child's main programme) are compared instead, in the school's order. */
export function byClass(rows: readonly Row[]): ClassLine[] {
  const by = new Map<string, Row[]>()
  for (const r of rows) by.set(r.class_id, [...(by.get(r.class_id) ?? []), r])
  return [...by.entries()].map(([classId, list]) => {
    const k = kpis(list)
    return { classId, name: list[0]!.class, rate: k.attendanceRate, present: k.counts.present + k.counts.late, due: k.counts.present + k.counts.late + k.counts.absent + k.counts.notRecorded, latePickups: k.latePickups, incomplete: k.incomplete }
  }).sort((a, b) => byClassOrder(a.name, b.name))
}

// Programmes and students --------------------------------------------------------------------------------------------------

export interface GroupLine { name: string; students: number; present: number; late: number; absent: number; notRecorded: number; due: number; rate: number | null; latePickups: number; incomplete: number }
const lineOf = (name: string, list: readonly Row[]): GroupLine => {
  const k = kpis(list)
  const c = k.counts
  return {
    name, students: new Set(list.map((r) => r.child_id)).size, present: c.present + c.late, late: c.late, absent: c.absent, notRecorded: c.notRecorded,
    due: c.present + c.late + c.absent + c.notRecorded, rate: k.attendanceRate, latePickups: k.latePickups, incomplete: k.incomplete,
  }
}

/** One line per main programme (each child in one, so the lines add up to the whole report), in the given order. */
export function byProgramme(rows: readonly Row[], order: (a: string, b: string) => number = (a, b) => a.localeCompare(b)): GroupLine[] {
  const by = new Map<string, Row[]>()
  for (const r of rows) by.set(r.programme, [...(by.get(r.programme) ?? []), r])
  return [...by.entries()].map(([name, list]) => lineOf(name, list)).sort((a, b) => order(a.name, b.name))
}

export interface StudentLine extends GroupLine { childId: string; class: string; programme: string; lateArrivals: number; verifiedDropoffs: number; verifiedPickups: number }
/** One line per student: their days in the period, by status, sorted by programme then name. */
export function byStudent(rows: readonly Row[], order: (a: string, b: string) => number = (a, b) => a.localeCompare(b)): StudentLine[] {
  const by = new Map<string, Row[]>()
  for (const r of rows) by.set(r.child_id, [...(by.get(r.child_id) ?? []), r])
  return [...by.entries()].map(([childId, list]) => {
    const first = list[0]!
    return {
      ...lineOf(first.child, list), childId, class: first.class, programme: first.programme,
      lateArrivals: list.filter((r) => r.lateArrivalMin !== null).length,
      verifiedDropoffs: list.filter((r) => r.dropoffVerified).length, verifiedPickups: list.filter((r) => r.pickupVerified).length,
    }
  }).sort((a, b) => order(a.programme, b.programme) || a.name.localeCompare(b.name, 'en-IN'))
}

// Words -------------------------------------------------------------------------------------------------------------------

export const pct = (v: number | null, digits = 1) => (v === null ? '—' : `${(v * 100).toFixed(digits)}%`)
export const timeOf = (min: number | null) => (min === null ? '—' : formatTime(min))

/**
 * Up to three observations, each from figures in this report only, and only when there is enough data to say it: the
 * busiest gate half hour, late pickups and the weekday they cluster on, the change in attendance between the first and
 * second half of the period, and missing records. Never a reason or a guess.
 */
export function insights(rows: readonly Row[], pts: readonly PeriodPoint[]): string[] {
  const out: string[] = []
  const k = kpis(rows)
  const { busiest } = gateActivity(rows)
  const gateEvents = k.verifiedDropoffs + k.verifiedPickups
  if (busiest && gateEvents >= 10) {
    const n = busiest.dropoffs + busiest.pickups
    out.push(`Busiest gate half hour: ${binRange(busiest)}, with ${n} of ${gateEvents} verified drop-offs and pickups (${pct(n / gateEvents, 0)}).`)
  }
  if (k.latePickups >= 3) {
    const byDay = new Map<number, number>()
    for (const r of rows) if (r.latePickupMin !== null) byDay.set(weekdayOf(r.day), (byDay.get(weekdayOf(r.day)) ?? 0) + 1)
    const [top, n] = [...byDay.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]!
    const share = k.verifiedPickups ? ` (${pct(k.latePickups / k.verifiedPickups, 0)} of verified pickups)` : ''
    // The weekday only when they cluster on one: at least two, and at least 40% of them.
    out.push(`${k.latePickups} late pickups${share}${n >= 2 && n / k.latePickups >= 0.4 ? `; ${n} of them on a ${WEEKDAYS[top - 1]}` : ''}.`)
  }
  const rated = pts.filter((p) => p.rate !== null && p.due > 0)
  if (rated.length >= 4) {
    const half = Math.floor(rated.length / 2)
    const avg = (list: PeriodPoint[]) => list.reduce((a, p) => a + p.rate!, 0) / list.length
    const a = avg(rated.slice(0, half))
    const b = avg(rated.slice(rated.length - half))
    if (Math.abs(b - a) >= 0.02) out.push(`Attendance ${b > a ? 'rose' : 'fell'} from ${pct(a)} in the first half of the period to ${pct(b)} in the second.`)
  }
  if (k.incomplete > 0) out.push(`${k.notRecorded} expected child-days have no attendance record and ${k.missingVerification} lack a verified drop-off or pickup.`)
  else if (k.notKept === 0 && k.counts.present + k.counts.late + k.counts.absent > 0) out.push('Every expected child-day has a record, with drop-offs and pickups verified.')
  // Always said when it applies: without it, older days would read as on time and fully verified.
  if (k.notKept > 0) return [...out.slice(0, 2), `Gate details are kept for 30 days: for ${k.notKept} earlier child-days only the recorded times remain, so lateness and who handed over aren't shown.`]
  return out.slice(0, 3)
}
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

/** The rows that need attention, newest first: no record, a missing verification, or a late pickup. */
export const exceptions = (rows: readonly Row[]) =>
  rows.filter((r) => r.issues.length).sort((a, b) => b.day.localeCompare(a.day) || a.child.localeCompare(b.child))

export const ATTENDANCE_LABEL: Record<Attendance, string> = {
  present: 'Present', late: 'Late', absent: 'Absent', not_recorded: 'Not recorded', expected: 'Expected', not_due: 'Not due',
}
export const RECORD_LABEL: Record<RecordState, string> = { complete: 'Complete', on_campus: 'On campus', not_kept: 'Over 30 days', incomplete: 'Incomplete', none: '—' }
export const SOURCE_LABEL: Record<Source, string> = { gate: 'Verified at the gate', corrected: 'Corrected by the admin', record: 'Recorded, not verified', expired: 'Recorded; gate details kept 30 days' }
