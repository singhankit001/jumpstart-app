import { GATE_CLOSES, GATE_OPENS, SCHOOL_CLOSES, SCHOOL_OPENS, weekdayOf, type Minutes } from './time'

export type Direction = 'dropoff' | 'pickup'
export type SaturdayRule = 'every' | 'except_2nd_and_last'

export interface TimeWindow {
  from: Minutes
  to: Minutes
}

/** A timing plan (PRD D19), e.g. "Jr KG · Half day" or "Learning Center". */
export interface Programme {
  name: string
  /** 1 = Monday … 6 = Saturday. The school never runs on Sunday. */
  weekdays: readonly number[]
  saturdayRule: SaturdayRule
  /** Inclusive YYYY-MM-DD dates; null means all year. */
  term: { start: string; end: string } | null
  hours: TimeWindow
  /** Fixed windows, or 'flexible': any time within the hours (Learning Center, 360°+). */
  windows: { dropoff: TimeWindow; pickup: TimeWindow } | 'flexible'
}

const LEVEL_WORDS: Record<string, string> = { 'Jr KG': 'Junior KG', 'Sr KG': 'Senior KG' }
const PLAN_WORDS: Record<string, string> = { 'Half day (morning)': 'Morning', 'Half day (afternoon)': 'Afternoon', '360°': '360', '360°+': '360 plus' }

/**
 * A child's class as the school says it: the stored programme name ("Jr KG · 360°+", which the timings and the gate rules
 * read) in the school's words ("Junior KG 360 plus"). Class and programme are one thing on every screen and file.
 */
export function classLabel(programme: string): string {
  const [level, plan] = programme.split(' · ') as [string, string | undefined]
  if (!plan) return programme
  return `${LEVEL_WORDS[level] ?? level} ${PLAN_WORDS[plan] ?? plan}`
}

const LEVEL_ORDER = ['Playgroup', 'Nursery', 'Junior KG', 'Senior KG', 'Learning Center', 'Preschool Readiness Program', 'After School Program']
const levelRank = (label: string) => {
  const i = LEVEL_ORDER.findIndex((l) => label === l || label.startsWith(`${l} `))
  return i < 0 ? LEVEL_ORDER.length : i
}
const planRank = (label: string) => (/ Morning$| Half day$/.test(label) ? 0 : / Afternoon$/.test(label) ? 1 : / 360$/.test(label) ? 2 : / 360 plus$/.test(label) ? 3 : 4)
/** The school's order for classes, given as stored names or labels: by level, then morning, afternoon, 360, 360 plus. */
export function byClassOrder(a: string, b: string): number {
  const x = classLabel(a)
  const y = classLabel(b)
  return levelRank(x) - levelRank(y) || planRank(x) - planRank(y) || x.localeCompare(y, 'en-IN')
}

/** Everything wrong with a programme, as sentences for the form. Empty when valid. */
export function programmeErrors(p: Programme): string[] {
  const errors: string[] = []
  if (!p.name.trim()) errors.push('Give the programme a name.')
  if (p.weekdays.length === 0) errors.push('Choose at least one day.')
  if (p.weekdays.some((d) => !Number.isInteger(d) || d < 1 || d > 6)) errors.push('Days must be Monday to Saturday.')
  if (p.hours.from < SCHOOL_OPENS || p.hours.to > SCHOOL_CLOSES) errors.push('Hours must be within school hours, 9:00 AM to 7:00 PM.')
  if (p.hours.from >= p.hours.to) errors.push('The programme must end after it starts.')
  if (p.term && p.term.start > p.term.end) errors.push('The term must end after it starts.')
  if (p.windows !== 'flexible') {
    for (const [label, w] of [['drop-off', p.windows.dropoff], ['pickup', p.windows.pickup]] as const) {
      if (w.from > w.to) errors.push(`The ${label} window must end after it starts.`)
      // Windows sit around the class (D24): drop-off before it starts, pickup after it ends, inside the gate day.
      else if (w.from < GATE_OPENS || w.to > GATE_CLOSES) errors.push(`The ${label} window must be within 8:45 AM to 7:15 PM.`)
    }
  }
  return errors
}

/** Does the programme run on this date? Holidays are YYYY-MM-DD dates. */
export function runsOn(p: Programme, isoDate: string, holidays: ReadonlySet<string>): boolean {
  const weekday = weekdayOf(isoDate)
  if (weekday === 7 || !p.weekdays.includes(weekday) || holidays.has(isoDate)) return false
  if (p.term && (isoDate < p.term.start || isoDate > p.term.end)) return false
  if (weekday === 6 && p.saturdayRule === 'except_2nd_and_last') {
    const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number]
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate()
    const isSecond = Math.ceil(d / 7) === 2
    const isLast = d + 7 > daysInMonth
    if (isSecond || isLast) return false
  }
  return true
}

/** A programme's drop-off or pickup window, shown as information (D56: it never limits a time). */
export function windowFor(p: Programme, direction: Direction): TimeWindow {
  return p.windows === 'flexible' ? p.hours : p.windows[direction]
}
