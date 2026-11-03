import { describe, expect, it } from 'vitest'
import { formatTime, indiaClock, toMinutes } from './time'
import { byClassOrder, classLabel, programmeErrors, runsOn, type Programme } from './programme'
import { formatAge, freshness } from './freshness'
import { lateBand } from './lateness'

const t = toMinutes
const noHolidays = new Set<string>()

// Karve Road programmes from PRD §5.
const jrKgHalfDay: Programme = {
  name: 'Jr KG · Half day',
  weekdays: [1, 2, 3, 4, 5],
  saturdayRule: 'every',
  term: { start: '2026-06-01', end: '2027-03-31' },
  hours: { from: t('09:00'), to: t('13:00') },
  // D24: the 15 minutes before the class starts and the 15 minutes after it ends.
  windows: { dropoff: { from: t('08:45'), to: t('09:00') }, pickup: { from: t('13:00'), to: t('13:15') } },
}
const learningCenter: Programme = {
  name: 'Learning Center',
  weekdays: [1, 2, 3, 4, 5, 6],
  saturdayRule: 'except_2nd_and_last',
  term: null,
  hours: { from: t('09:00'), to: t('19:00') },
  // In at 8:45–9:00, collected any time until 7 PM (D24).
  windows: { dropoff: { from: t('08:45'), to: t('09:00') }, pickup: { from: t('09:00'), to: t('19:00') } },
}

describe('time', () => {
  it('parses and formats', () => {
    expect(t('09:30')).toBe(570)
    expect(formatTime(t('13:05'))).toBe('1:05 PM')
    expect(formatTime(t('12:00'))).toBe('12:00 PM')
    expect(() => t('9:30')).toThrow()
    expect(() => t('24:00')).toThrow()
  })
  it('reads India time from a UTC instant', () => {
    expect(indiaClock(new Date('2026-09-24T18:40:00Z'))).toEqual({ date: '2026-09-25', minutes: t('00:10'), weekday: 5 })
  })
})

describe('programmes', () => {
  it('accepts the Karve Road programmes', () => {
    expect(programmeErrors(jrKgHalfDay)).toEqual([])
    expect(programmeErrors(learningCenter)).toEqual([])
  })
  it('rejects hours outside school hours and windows outside the gate day', () => {
    expect(programmeErrors({ ...learningCenter, hours: { from: t('08:30'), to: t('19:00') } })).toContain(
      'Hours must be within school hours, 9:00 AM to 7:00 PM.',
    )
    const badWindow = { ...jrKgHalfDay, windows: { dropoff: { from: t('08:45'), to: t('09:00') }, pickup: { from: t('13:00'), to: t('19:30') } } }
    expect(programmeErrors(badWindow)).toEqual(['The pickup window must be within 8:45 AM to 7:15 PM.'])
  })
  it('knows which days a programme runs', () => {
    expect(runsOn(jrKgHalfDay, '2026-09-24', noHolidays)).toBe(true) // Thursday
    expect(runsOn(jrKgHalfDay, '2026-09-26', noHolidays)).toBe(false) // Saturday, Mon–Fri programme
    expect(runsOn(jrKgHalfDay, '2027-04-15', noHolidays)).toBe(false) // after the June–March term
    expect(runsOn(jrKgHalfDay, '2026-09-24', new Set(['2026-09-24']))).toBe(false)
  })
  it('skips the 2nd and last Saturday', () => {
    expect(runsOn(learningCenter, '2026-10-03', noHolidays)).toBe(true)
    expect(runsOn(learningCenter, '2026-10-10', noHolidays)).toBe(false) // 2nd
    expect(runsOn(learningCenter, '2026-10-24', noHolidays)).toBe(true) // 4th of 5
    expect(runsOn(learningCenter, '2026-10-31', noHolidays)).toBe(false) // last
    expect(runsOn(learningCenter, '2026-09-26', noHolidays)).toBe(false) // 4th and last of 4
  })
})

describe('freshness', () => {
  const now = 1_000_000
  it('labels by age', () => {
    expect(freshness(null, now)).toEqual({ state: 'unavailable', ageMs: null })
    expect(freshness({ fixAt: now - 14_999, receivedAt: now }, now).state).toBe('live')
    expect(freshness({ fixAt: now - 15_000, receivedAt: now }, now).state).toBe('recent')
    expect(freshness({ fixAt: now - 60_000, receivedAt: now }, now).state).toBe('stale')
  })
  it('never trusts a phone clock that runs ahead', () => {
    // Phone says the fix is from the future; the server received it 90 s ago.
    expect(freshness({ fixAt: now + 30_000, receivedAt: now - 90_000 }, now)).toEqual({ state: 'stale', ageMs: 90_000 })
  })
  it('formats ages', () => {
    expect(formatAge(32_000)).toBe('32s')
    expect(formatAge(185_000)).toBe('3 min')
    expect(formatAge(65 * 60_000)).toBe('1 h 5 min')
  })
})

describe('lateBand', () => {
  it('announces at the threshold and every 10 minutes after', () => {
    expect(lateBand(t('12:45'), t('12:54'))).toBe(0)
    expect(lateBand(t('12:45'), t('12:55'))).toBe(10)
    expect(lateBand(t('12:45'), t('13:04'))).toBe(10)
    expect(lateBand(t('12:45'), t('13:05'))).toBe(20)
    expect(lateBand(t('12:45'), t('12:30'))).toBe(0)
  })
})

describe('contact details', async () => {
  const { normalizeEmail, normalizeMobile, normalizeIndianPhone, formatMobile, whatsappUrl } = await import('./contact')
  it('normalizes emails', () => {
    expect(normalizeEmail('  Sneha.K@Example.COM ')).toBe('sneha.k@example.com')
    expect(normalizeEmail('not-an-email')).toBeNull()
    expect(normalizeEmail('a@b')).toBeNull()
  })
  it('accepts Indian mobiles in any common format', () => {
    for (const v of ['98765 43210', '+91 98765 43210', '+91-98765-43210', '09876543210', '919876543210', '0091 9876543210', '091 9876543210',
      '+91 098765 43210', '0091 0 9876543210', '91 0 98765 43210', ' 098765-43210 ']) {
      expect(normalizeMobile(v)).toBe('+919876543210')
    }
  })
  // Contract change (PRD D26, 2026-09-24): families abroad have numbers from other countries, given with + or 00.
  it('accepts other countries with their code', () => {
    expect(normalizeMobile('+1 415 555 0100')).toBe('+14155550100')
    expect(normalizeMobile('00971 50 123 4567')).toBe('+971501234567')
    expect(normalizeMobile('+971 50 123 4567')).toBe('+971501234567')
  })
  it('rejects landlines, short numbers, and foreign numbers without a code', () => {
    expect(normalizeMobile('020 2545 1234')).toBeNull()
    expect(normalizeMobile('98765')).toBeNull()
    expect(normalizeMobile('+91 20 2545 1234')).toBeNull()
    expect(normalizeMobile('5876543210')).toBeNull()
    expect(normalizeMobile('0')).toBeNull()
  })
  it("takes the school's own number in any common format, landline or mobile", () => {
    for (const v of ['020 2545 1234', '+91 20 2545 1234', '+91 020 2545 1234', '0091 20 2545 1234', '0091 020 2545 1234', '912025451234']) {
      expect(normalizeIndianPhone(v)).toBe('+912025451234')
    }
    expect(normalizeIndianPhone('9123456789')).toBe('+919123456789')
    expect(normalizeIndianPhone('2545 1234')).toBeNull()
  })
  it('formats for display, and links to WhatsApp', () => {
    expect(formatMobile('+919876543210')).toBe('+91 98765 43210')
    expect(formatMobile('+14155550100')).toBe('+14155550100')
    expect(whatsappUrl('+919876543210', 'Hi & bye')).toBe('https://wa.me/919876543210?text=Hi%20%26%20bye')
  })
})

describe('classLabel', () => {
  it("names every class the way the school's list does", () => {
    const pairs: Array<[string, string]> = [
      ['Playgroup · Half day (morning)', 'Playgroup Morning'], ['Playgroup · Half day (afternoon)', 'Playgroup Afternoon'],
      ['Playgroup · 360°', 'Playgroup 360'], ['Playgroup · 360°+', 'Playgroup 360 plus'], ['Nursery · Half day (afternoon)', 'Nursery Afternoon'],
      ['Jr KG · Half day', 'Junior KG Half day'], ['Jr KG · 360°', 'Junior KG 360'], ['Jr KG · 360°+', 'Junior KG 360 plus'],
      ['Sr KG · Half day', 'Senior KG Half day'], ['Sr KG · 360°', 'Senior KG 360'], ['Sr KG · 360°+', 'Senior KG 360 plus'],
      ['Learning Center', 'Learning Center'], ['After School Program', 'After School Program'],
    ]
    for (const [stored, label] of pairs) expect(classLabel(stored)).toBe(label)
  })
  it('orders classes by level, then morning, afternoon, 360, 360 plus, whether stored names or labels', () => {
    const shuffled = ['Learning Center', 'Sr KG · Half day', 'Nursery 360 plus', 'Playgroup · 360°', 'Playgroup Afternoon', 'Nursery · Half day (morning)', 'Jr KG · 360°+', 'Playgroup · Half day (morning)']
    expect([...shuffled].sort(byClassOrder).map(classLabel)).toEqual([
      'Playgroup Morning', 'Playgroup Afternoon', 'Playgroup 360', 'Nursery Morning', 'Nursery 360 plus', 'Junior KG 360 plus', 'Senior KG Half day', 'Learning Center',
    ])
  })
})
