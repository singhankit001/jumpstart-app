import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildDoc, THEMES } from './doc'
import { sampleReport } from './fixture'
import { detailedPdf, executivePdf, type PdfAssets } from './pdf'

const dir = join(__dirname, '..')
const b64 = (f: string) => readFileSync(join(dir, 'fonts', f)).toString('base64')
const assets: PdfAssets = { regular: b64('PlusJakartaSans-Regular.ttf'), semibold: b64('PlusJakartaSans-SemiBold.ttf'), bold: b64('PlusJakartaSans-ExtraBold.ttf'), logo: new Uint8Array(readFileSync(join(dir, 'logo.png'))) }
// Set REPORT_SAMPLES=<dir> to keep the files for looking at (pdftoppm -png).
const keep = (name: string, bytes: ArrayBuffer) => {
  const out = process.env.REPORT_SAMPLES
  if (!out) return
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, name), new Uint8Array(bytes))
}
const text = (bytes: ArrayBuffer) => new TextDecoder('latin1').decode(new Uint8Array(bytes))
const pagesOf = (bytes: ArrayBuffer) => [...text(bytes).matchAll(/\/Type \/Page[^s]/g)].length
const doc = (data = sampleReport(), theme = THEMES.navy) => buildDoc({ data, reportId: 'JSG-20261102-000042', generatedAt: '2026-11-02T07:00:00Z', scope: 'All classes · all programmes', theme })

describe('executive PDF', () => {
  it('is exactly one A4 landscape page, with the fonts embedded and its metadata', () => {
    const pdf = executivePdf(doc(), assets)
    keep('executive.pdf', pdf)
    const t = text(pdf)
    expect(pagesOf(pdf)).toBe(1)
    expect(t).toMatch(/\/MediaBox \[0 0 841\.8[89]\d* 595\.2[78]\d*\]/)
    expect(t).toMatch(/\/FontFile2/)
    // Title, author and keywords (stored as UTF-16 because of the middle dot).
    expect(t).toMatch(/\/Title \(/)
    expect(t).toMatch(/\/Keywords \(/)
  })
  it('stays one page with long names, a whole year, a monochrome theme and no data at all', () => {
    const long = executivePdf(doc(sampleReport({ longNames: true, from: '2025-11-01', to: '2026-10-31', children: 60 }), THEMES.mono), assets)
    keep('executive-year-long-mono.pdf', long)
    expect(pagesOf(long)).toBe(1)
    const empty = executivePdf(doc({ ...sampleReport(), rows: [] }), assets)
    keep('executive-empty.pdf', empty)
    expect(pagesOf(empty)).toBe(1)
  })
})

describe('detailed PDF', () => {
  const day = (data = sampleReport(), d = '2026-10-15') => ({ ...data, from: d, to: d, cutoff: d, rows: data.rows.filter((r) => r.day === d) })
  it('has every row, grouped by class, on as many numbered pages as it takes', () => {
    const d = doc()
    const pdf = detailedPdf(d, assets)
    keep('detailed.pdf', pdf)
    const t = text(pdf)
    expect(pagesOf(pdf)).toBeGreaterThan(1)
    expect(d.rows.length).toBeGreaterThan(600)
    expect(d.classes.map((c) => c.name)).toEqual(['Playgroup', 'Nursery', 'Jr KG'])
    expect(t).toMatch(/\/FontFile2/)
  })
  it('lays out one day, one class, one student, long names, missing times and no data', () => {
    const oneDay = detailedPdf(doc(day()), assets)
    keep('detailed-one-day.pdf', oneDay)
    expect(pagesOf(oneDay)).toBeGreaterThanOrEqual(1)
    const data = day()
    const oneClass = detailedPdf(doc({ ...data, rows: data.rows.filter((r) => r.class_id === 'k2') }), assets)
    keep('detailed-one-class.pdf', oneClass)
    expect(pagesOf(oneClass)).toBe(1)
    const one = detailedPdf(doc({ ...data, rows: data.rows.filter((r) => r.child_id === 'c1') }), assets)
    keep('detailed-one-student.pdf', one)
    expect(pagesOf(one)).toBe(1)
    const long = detailedPdf(doc(day(sampleReport({ longNames: true }))), assets)
    keep('detailed-long-names.pdf', long)
    // Checked in, never collected: stays on the register as not checked out, never as gone.
    const missing = { ...data, rows: data.rows.slice(0, 6).map((r, i) => (i < 3 ? { ...r, pickup_at: null, pickup_source: null } : i === 3 ? { ...r, marked: null, dropoff_at: null, pickup_at: null, dropoff_source: null, pickup_source: null } : r)) }
    const gaps = detailedPdf(doc(missing), assets)
    keep('detailed-missing-times.pdf', gaps)
    expect(pagesOf(gaps)).toBe(1)
    const empty = detailedPdf(doc({ ...data, rows: [] }), assets)
    keep('detailed-empty.pdf', empty)
    expect(pagesOf(empty)).toBe(1)
  })
})

describe('detailed PDF by class', () => {
  it('handles several classes in a level, and the class lines add up to the report', () => {
    const data = sampleReport()
    // Two programmes in every class: half of each class on a different plan.
    const mixed = { ...data, rows: data.rows.map((r) => (Number(r.child_id.slice(1)) % 2 ? { ...r, programme: `${r.class} · 360°` } : r)) }
    const d = doc(mixed)
    expect(d.programmes.length).toBe(6)
    expect(d.programmes.reduce((s, p) => s + p.students, 0)).toBe(new Set(d.rows.map((r) => r.child_id)).size)
    expect(d.programmes.reduce((s, p) => s + p.due, 0)).toBe(d.kpis.counts.present + d.kpis.counts.late + d.kpis.counts.absent + d.kpis.counts.notRecorded)
    const pdf = detailedPdf(d, assets)
    keep('detailed-by-programme.pdf', pdf)
    expect(pagesOf(pdf)).toBeGreaterThan(1)
  })
})
