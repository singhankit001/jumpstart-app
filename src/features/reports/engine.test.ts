import { describe, expect, it } from 'vitest'
import { byClass, classify, classifyAll, exceptions, gateActivity, grainFor, insights, kpis, LATE_MIN, periodOf, periods, series, type RawRow, type ReportData } from './engine'

// IST is UTC+05:30: 03:35Z is 09:05 in the school.
const ist = (day: string, hm: string) => new Date(`${day}T${hm}:00+05:30`).toISOString()
const NOW = Date.parse('2026-03-09T10:00:00+05:30')
const row = (o: Partial<RawRow> = {}): RawRow => ({
  child_id: 'c1', child: 'Riya One', class: 'Nursery', class_id: 'k1', programme: 'Half day', day: '2026-03-02', expected: true,
  sched_in: '09:00', sched_out: '13:00', marked: null, note: null, dropoff_at: null, pickup_at: null, dropoff_source: null, pickup_source: null,
  dropoff_by: null, pickup_by: null, pickup_to: null, dropoff_announced_at: null, pickup_announced_at: null, pickup_arrived_at: null, ready_at: null,
  corrections: [], ...o,
})
const gateDay = (day: string, inAt = '09:05', outAt = '13:05', o: Partial<RawRow> = {}) => row({
  day, marked: 'present', dropoff_at: ist(day, inAt), pickup_at: ist(day, outAt), dropoff_source: 'gate', pickup_source: 'gate', ...o,
})
const c = (r: RawRow) => classify(r, NOW, '2026-03-09')

describe('statuses', () => {
  it('a day verified at the gate both ways is present and complete, in India time', () => {
    const r = c(gateDay('2026-03-02'))
    expect([r.attendance, r.record, r.dropoffMin, r.pickupMin]).toEqual(['present', 'complete', 9 * 60 + 5, 13 * 60 + 5])
  })
  it('late only beyond the threshold, and only for verified times', () => {
    expect(c(gateDay('2026-03-02', `09:${String(LATE_MIN).padStart(2, '0')}`)).attendance).toBe('present')
    expect(c(gateDay('2026-03-02', '09:25')).attendance).toBe('late')
    expect(c(gateDay('2026-03-02', '09:25')).lateArrivalMin).toBe(25)
    expect(c(gateDay('2026-03-02', '09:25', '13:05', { dropoff_source: 'record' })).attendance).toBe('present')
    expect(c(gateDay('2026-03-02', '09:05', '13:40')).latePickupMin).toBe(40)
    expect(c(gateDay('2026-03-02', '09:05', '13:10')).latePickupMin).toBeNull()
  })
  it('an older record without a gate action is present but not verified, so the day is incomplete', () => {
    const r = c(gateDay('2026-03-02', '09:05', '13:05', { dropoff_source: 'record' }))
    expect([r.attendance, r.record, r.dropoffVerified]).toEqual(['present', 'incomplete', false])
    expect(r.issues).toContain('Drop-off not verified')
  })
  it('a missing pickup is incomplete on a past day, and on campus today', () => {
    expect(c(gateDay('2026-03-02', '09:05', '13:05', { pickup_at: null, pickup_source: null })).issues).toEqual(['No pickup recorded'])
    expect(c(gateDay('2026-03-09', '09:05', '13:05', { pickup_at: null, pickup_source: null })).record).toBe('on_campus')
  })
  it('a day from before the 30 days gate details are kept is present, neither incomplete nor late, and said so', () => {
    const old = gateDay('2026-03-02', '09:40', '13:05', { dropoff_source: 'expired', pickup_source: 'expired' })
    const r = c(old)
    expect([r.attendance, r.record, r.dropoffVerified, r.lateArrivalMin, r.issues]).toEqual(['present', 'not_kept', false, null, []])
    const k = kpis([r, c(gateDay('2026-03-03'))])
    expect([k.notKept, k.missingVerification, k.incomplete, k.lateArrivals, k.verifiedDropoffs]).toEqual([1, 0, 0, 0, 1])
    expect(insights([r], []).at(-1)).toMatch(/^Gate details are kept for 30 days: for 1 earlier child-days/)
    expect(insights([r], []).join(' ')).not.toMatch(/verified\.$|pickups verified/)
    // A correction is kept for good, so a corrected old day is still verified.
    expect(c({ ...old, dropoff_source: 'corrected', pickup_source: 'corrected' }).record).toBe('complete')
  })
  it('a corrected time is verified (an admin, with a reason)', () => {
    expect(c(gateDay('2026-03-02', '09:05', '13:05', { pickup_source: 'corrected' })).record).toBe('complete')
  })
  it('absent and on leave are absent; off is not due; nothing at all is not recorded, or still expected today', () => {
    expect(c(row({ marked: 'absent' })).attendance).toBe('absent')
    expect(c(row({ marked: 'on_leave' })).attendance).toBe('absent')
    expect(c(row({ marked: 'off' })).attendance).toBe('not_due')
    expect(c(row()).attendance).toBe('not_recorded')
    expect(c(row({ day: '2026-03-09' })).attendance).toBe('expected')
    expect(c(row({ day: '2026-03-09', sched_out: '09:30' })).attendance).toBe('not_recorded')
    expect(c(row({ expected: false })).attendance).toBe('not_due')
  })
  it('an announcement is never attendance', () => {
    const r = c(row({ pickup_announced_at: ist('2026-03-02', '12:45'), pickup_arrived_at: ist('2026-03-02', '13:00'), ready_at: ist('2026-03-02', '12:55') }))
    expect([r.attendance, r.pickupVerified]).toEqual(['not_recorded', false])
  })
})

describe('KPIs', () => {
  const data = (rows: RawRow[]): ReportData => ({ generated_at: '', from: '2026-03-02', to: '2026-03-08', cutoff: '2026-03-08', today: '2026-03-09', timezone: 'Asia/Kolkata', verification_from: '2026-02-07', holidays: [], rows })
  it('follow their formulas', () => {
    const rows = classifyAll(data([
      gateDay('2026-03-02', '09:05', '13:05'), gateDay('2026-03-03', '09:25', '13:45'),
      row({ day: '2026-03-05', marked: 'absent' }), row({ day: '2026-03-06' }),
      gateDay('2026-03-06', '08:55', '13:05', { child_id: 'c2', child: 'Rohan', pickup_at: null, pickup_source: null }),
    ]), NOW)
    const k = kpis(rows)
    expect(k.attendanceRate).toBeCloseTo(3 / 4)            // 2 present + 1 late of 4 recorded
    expect(k.coverage).toBeCloseTo(4 / 5)                  // 4 recorded of 5 due
    expect([k.verifiedDropoffs, k.verifiedPickups, k.lateArrivals, k.latePickups]).toEqual([3, 2, 1, 1])
    expect(k.avgArrivalMin).toBe(Math.round((545 + 565 + 535) / 3))
    expect([k.notRecorded, k.missingVerification, k.incomplete]).toEqual([1, 1, 2])
  })
  it('say nothing rather than zero when there is no data', () => {
    const k = kpis([])
    expect([k.attendanceRate, k.coverage, k.avgArrivalMin]).toEqual([null, null, null])
    expect(insights([], [])).toEqual([])
  })
  it('one duplicate gate event is one child-day (the server returns one row per child and day)', () => {
    expect(kpis(classifyAll(data([gateDay('2026-03-02')]), NOW)).verifiedDropoffs).toBe(1)
  })
})

describe('periods and charts', () => {
  it('chooses days, weeks or months by length, and keeps empty periods as gaps', () => {
    expect([grainFor('2026-03-01', '2026-03-31'), grainFor('2026-03-01', '2026-05-31'), grainFor('2026-01-01', '2026-12-31')]).toEqual(['day', 'week', 'month'])
    const pts = series(classifyAll({ generated_at: '', from: '2026-03-02', to: '2026-03-08', cutoff: '', today: '2026-03-09', timezone: '', verification_from: '', holidays: [], rows: [gateDay('2026-03-02')] }, NOW), '2026-03-02', '2026-03-08')
    expect(pts).toHaveLength(7)
    expect(pts[0]!.rate).toBe(1)
    expect(pts[2]!.rate).toBeNull()   // the holiday: a gap, never 0%
  })
  it('weeks start on Monday and months on the 1st, across month and year ends', () => {
    expect(periodOf('2026-03-01', 'week')).toBe('2026-02-23')
    expect(periodOf('2026-01-01', 'week')).toBe('2025-12-29')
    expect(periodOf('2026-02-28', 'month')).toBe('2026-02-01')
    expect(periods('2026-01-30', '2026-03-02', 'month')).toEqual(['2026-01-01', '2026-02-01', '2026-03-01'])
  })
  it('gate activity counts verified events per half hour and names the busiest', () => {
    const rows = [gateDay('2026-03-02', '09:05', '13:05'), gateDay('2026-03-03', '09:20', '13:10'), gateDay('2026-03-04', '08:10', '13:15', { pickup_source: 'record' })].map(c)
    const { bins, busiest } = gateActivity(rows)
    expect(bins.find((b) => b.from === 9 * 60)!.dropoffs).toBe(2)
    expect(bins.find((b) => b.from === 13 * 60)!.pickups).toBe(2)   // the unverified one isn't counted
    expect(busiest!.from).toBe(9 * 60)                                // tie: the earlier half hour
    expect(gateActivity([]).busiest).toBeNull()
  })
  it('compares classes in the school order', () => {
    const lines = byClass([gateDay('2026-03-02'), row({ class_id: 'k2', class: 'Jr KG', marked: 'absent' })].map(c))
    expect(lines.map((l) => [l.name, l.rate])).toEqual([['Nursery', 1], ['Jr KG', 0]])
  })
})

describe('insights and exceptions say only what the data shows', () => {
  it('names the busiest half hour and late pickups with their numbers', () => {
    const rows = ['02', '03', '04', '05', '06'].flatMap((d) => [gateDay(`2026-03-${d}`, '09:05', '13:30'), gateDay(`2026-03-${d}`, '09:10', '13:05', { child_id: 'c2' })]).map(c)
    const text = insights(rows, series(rows, '2026-03-02', '2026-03-06'))
    expect(text[0]).toMatch(/^Busiest gate half hour: 9:00 AM–9:30 AM, with 10 of 20 verified/)
    expect(text[1]).toBe('5 late pickups (50% of verified pickups).')
    expect(text.length).toBeLessThanOrEqual(3)
  })
  it('names a weekday only when late pickups cluster on it', () => {
    const rows = [gateDay('2026-03-02', '09:05', '13:40'), gateDay('2026-03-09', '09:05', '13:40'), gateDay('2026-03-04', '09:05', '13:40')].map(c)
    expect(insights(rows, [])).toContain('3 late pickups (100% of verified pickups); 2 of them on a Monday.')
  })
  it('lists the rows that need attention, newest first', () => {
    const list = exceptions([row({ day: '2026-03-02' }), gateDay('2026-03-03'), row({ day: '2026-03-04' })].map(c))
    expect(list.map((r) => r.day)).toEqual(['2026-03-04', '2026-03-02'])
  })
})
