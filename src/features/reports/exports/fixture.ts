import type { RawRow, ReportData } from '../engine'

/**
 * TEST FIXTURE ONLY: a made-up month for checking the reports' layout and figures in tests. Never sent to a database,
 * never shown in the app. Deterministic, so a rendered PDF can be compared from run to run.
 */
export function sampleReport(o: { from?: string; to?: string; children?: number; longNames?: boolean } = {}): ReportData {
  const from = o.from ?? '2026-10-01'
  const to = o.to ?? '2026-10-31'
  let seed = 7
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const classes = [['k1', 'Playgroup'], ['k2', 'Nursery'], ['k3', o.longNames ? 'Junior Kindergarten Extended Day With After School Programme' : 'Jr KG']] as const
  const first = ['Aarav', 'Diya', 'Vihaan', 'Anaya', 'Kabir', 'Myra', 'Reyansh', 'Saanvi', 'Arjun', 'Ira', 'Advik', 'Kiara']
  const last = ['Sharma', 'Kulkarni', 'Joshi', 'Deshpande', 'Patil', 'Iyer', 'Mehta', 'Rao']
  const rows: RawRow[] = []
  const iso = (day: string, min: number) => new Date(Date.parse(`${day}T00:00:00+05:30`) + min * 60_000).toISOString()
  for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.toISOString().slice(0, 10)
    const wd = d.getUTCDay()
    if (wd === 0 || wd === 6 || day === '2026-10-02' || day === '2026-10-20') continue
    for (let i = 0; i < (o.children ?? 36); i++) {
      const [class_id, cls] = classes[i % 3]!
      const schedIn = 9 * 60
      const schedOut = i % 3 === 0 ? 12 * 60 + 30 : i % 3 === 1 ? 13 * 60 : 17 * 60 + 30
      const r = rand()
      const base: RawRow = {
        child_id: `c${i}`, child: o.longNames && i === 0 ? 'Aaradhya Venkatanarayanan Subramaniam-Krishnamurthy' : `${first[i % 12]} ${last[(i + Math.floor(i / 12)) % 8]}`,
        class: cls, class_id, programme: `${cls} · ${i % 3 === 2 ? 'Day care' : 'Half day'}`, day, expected: true,
        sched_in: '09:00', sched_out: `${String(Math.floor(schedOut / 60)).padStart(2, '0')}:${String(schedOut % 60).padStart(2, '0')}`,
        marked: null, note: null, dropoff_at: null, pickup_at: null, dropoff_source: null, pickup_source: null, dropoff_by: null, pickup_by: null,
        pickup_to: null, dropoff_announced_at: null, pickup_announced_at: null, pickup_arrived_at: null, ready_at: null, corrections: [],
      }
      if (r < 0.07) { rows.push({ ...base, marked: 'absent', note: 'Unwell' }); continue }
      if (r < 0.09) { rows.push(base); continue }
      const inAt = schedIn - 15 + Math.floor(rand() * 40)
      const outAt = schedOut - 10 + Math.floor(rand() * (r > 0.93 ? 45 : 22))
      const noPickup = r > 0.985
      rows.push({
        ...base, marked: 'present', dropoff_at: iso(day, inAt), dropoff_source: r > 0.97 ? 'record' : 'gate', dropoff_by: 'Priya',
        pickup_at: noPickup ? null : iso(day, outAt), pickup_source: noPickup ? null : 'gate', pickup_by: noPickup ? null : 'Priya',
        pickup_to: noPickup ? null : 'Parent', pickup_announced_at: noPickup ? null : iso(day, outAt - 15), ready_at: noPickup ? null : iso(day, outAt - 5),
      })
    }
  }
  return {
    generated_at: `${to}T12:30:00Z`, from, to, cutoff: to, today: '2026-11-02', timezone: 'Asia/Kolkata', verification_from: from,
    holidays: [{ day: '2026-10-02', name: 'Gandhi Jayanti' }, { day: '2026-10-20', name: 'Diwali' }], rows,
  }
}
