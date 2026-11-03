import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { buildDoc, csv, DEFAULT_SECTIONS, safeCell } from './doc'
import { wordDocument } from './docx'
import { sampleReport } from './fixture'
import { SHEETS, TITLE, workbook } from './xlsx'

const keep = (name: string, bytes: ArrayBuffer | string) => {
  const out = process.env.REPORT_SAMPLES
  if (!out) return
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, name), typeof bytes === 'string' ? bytes : new Uint8Array(bytes))
}
// A child whose name starts like a formula, in Devanagari too, and a note with quotes and a line break.
const data = sampleReport({ children: 12 })
data.rows[3] = { ...data.rows[3]!, child: '=HYPERLINK("http://evil.example","Click")', note: 'Said "fever"\nwent home' }
data.rows[5] = { ...data.rows[5]!, child: 'आरव शर्मा' }
const doc = (sections = DEFAULT_SECTIONS) => buildDoc({ data, reportId: 'JSG-20261102-000042', generatedAt: '2026-11-02T07:00:00Z', scope: 'All classes', sections })

describe('CSV', () => {
  it('is UTF-8 with a BOM, CRLF lines, every text quoted, and no formula can run', () => {
    const text = csv(doc({ ...DEFAULT_SECTIONS, notes: true }))
    keep('register.csv', text)
    expect(text.startsWith('﻿"Date","Child"')).toBe(true)
    expect(text).toContain('\r\n')
    expect(text).toContain(`"'=HYPERLINK(""http://evil.example"",""Click"")"`)
    expect(text).toContain('"आरव शर्मा"')
    expect(text).toContain('"Said ""fever""\nwent home"')
    expect(text.split('\r\n').length - 2).toBe(doc().rows.length)
  })
  it('guards every leading character a spreadsheet treats as a formula', () => {
    for (const c of ['=', '+', '-', '@', '\t', '\r']) expect(safeCell(`${c}1`)).toBe(`'${c}1`)
    expect(safeCell('Riya')).toBe('Riya')
  })
  it('leaves guardian names and notes out unless asked', () => {
    expect(csv(doc())).not.toMatch(/Collected by|"Note"/)
    expect(csv(doc({ ...DEFAULT_SECTIONS, names: true }))).toContain('"Collected by"')
  })
})

describe('Excel', () => {
  const load = async (bytes: ArrayBuffer) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(bytes); return wb }
  const headers = (ws: ExcelJS.Worksheet) => (ws.getRow(HEAD_ROW).values as unknown[]).slice(1)
  const HEAD_ROW = 5

  it('has the five sheets, each titled, with a frozen, filtered, print-ready table and no formulas', async () => {
    const d = doc()
    const bytes = await workbook(d)
    keep('report.xlsx', bytes)
    const wb = await load(bytes)
    expect(wb.worksheets.map((w) => w.name)).toEqual([SHEETS.summary, SHEETS.detail, SHEETS.programmes, SHEETS.students, SHEETS.notes])
    for (const ws of wb.worksheets) {
      expect(ws.getCell('A1').value).toBe(TITLE)
      expect(String(ws.getCell('A3').value)).toContain('Reporting period: 1 Oct 2026 – 31 Oct 2026')
      expect(ws.pageSetup).toMatchObject({ paperSize: 9, fitToWidth: 1, fitToHeight: 0 })
      expect(ws.pageSetup.printArea).toMatch(/^A1:[A-Z]+\d+$/)
    }
    for (const name of [SHEETS.detail, SHEETS.programmes, SHEETS.students]) {
      const ws = wb.getWorksheet(name)!
      expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: HEAD_ROW })
      expect(ws.autoFilter).toBeTruthy()
      expect(ws.pageSetup.printTitlesRow).toBe('5:5')
      // No empty columns: every column has a header.
      expect(headers(ws).every((h) => typeof h === 'string' && h.length > 0)).toBe(true)
      expect(headers(ws).length).toBe(ws.columnCount)
    }
    let formulas = 0
    wb.eachSheet((ws) => ws.eachRow((r) => r.eachCell((c) => { if (c.type === ExcelJS.ValueType.Formula) formulas++ })))
    expect(formulas).toBe(0)
  })

  it('lists every child-day with real dates and times, and keeps formula-like names as plain text', async () => {
    const d = doc()
    const wb = await load(await workbook(d))
    const ws = wb.getWorksheet(SHEETS.detail)!
    expect(ws.rowCount).toBe(HEAD_ROW + d.rows.length)
    expect(headers(ws).slice(0, 5)).toEqual(['Date', 'Student', 'Programme', 'Class', 'Attendance status'])
    expect(ws.getCell(HEAD_ROW + 1, 1).value).toBeInstanceOf(Date)
    expect(ws.getCell(HEAD_ROW + 1, 1).numFmt).toBe('dd mmm yyyy')
    const withDropoff = ws.getColumn(6).values.findIndex((v, i) => i > HEAD_ROW && v instanceof Date)
    expect(ws.getCell(withDropoff, 6).numFmt).toBe('h:mm AM/PM')
    const names = ws.getColumn(2).values
    expect(names).toContain('=HYPERLINK("http://evil.example","Click")')
    expect(names).toContain('आरव शर्मा')
    // Statuses are the engine's, child-day for child-day.
    const statuses = ws.getColumn(5).values.slice(HEAD_ROW + 1) as string[]
    expect(statuses.filter((s) => s === 'Absent').length).toBe(d.kpis.counts.absent)
    expect(statuses.filter((s) => s === 'Not recorded').length).toBe(d.kpis.counts.notRecorded)
  })

  it('adds up: programme lines total the whole report, and student lines match the engine', async () => {
    const d = doc()
    const wb = await load(await workbook(d))
    const ws = wb.getWorksheet(SHEETS.programmes)!
    const body = ws.getRows(HEAD_ROW + 1, d.programmes.length)!.map((r) => r.values as unknown[])
    const total = ws.getRow(HEAD_ROW + d.programmes.length + 1).values as unknown[]
    expect(total[1]).toBe('All programmes')
    for (const col of [2, 3, 4, 5, 6, 7]) expect(body.reduce((s, r) => s + (r[col] as number), 0)).toBe(total[col])
    expect(total[2]).toBe(new Set(d.rows.map((r) => r.child_id)).size)
    expect(total[4]).toBe(d.kpis.counts.present + d.kpis.counts.late)
    expect(total[8]).toBeCloseTo(d.kpis.attendanceRate!, 10)
    const st = wb.getWorksheet(SHEETS.students)!
    expect(st.rowCount).toBe(HEAD_ROW + d.students.length)
    const sum = (col: number) => st.getRows(HEAD_ROW + 1, d.students.length)!.reduce((s, r) => s + (r.getCell(col).value as number), 0)
    expect(sum(5)).toBe(total[4])
    expect(sum(7)).toBe(total[6])
  })

  it('opens with no data, and with 1,000 students over a month, long names included', async () => {
    const empty = await load(await workbook(buildDoc({ data: { ...data, rows: [] }, reportId: 'X', generatedAt: '2026-11-02T07:00:00Z', scope: 'All' })))
    expect(String(empty.getWorksheet(SHEETS.detail)!.getCell(HEAD_ROW + 1, 1).value)).toMatch(/No attendance records/)
    const big = sampleReport({ children: 1000, longNames: true })
    const d = buildDoc({ data: big, reportId: 'JSG-BIG', generatedAt: '2026-11-02T07:00:00Z', scope: 'All' })
    const started = Date.now()
    const bytes = await workbook(d)
    keep('report-1000.xlsx', bytes)
    const ms = Date.now() - started
    const wb = await load(bytes)
    expect(wb.getWorksheet(SHEETS.students)!.rowCount).toBe(HEAD_ROW + 1000)
    expect(wb.getWorksheet(SHEETS.detail)!.rowCount).toBe(HEAD_ROW + d.rows.length)
    // The long name wraps onto more lines instead of being cut off.
    const long = wb.getWorksheet(SHEETS.students)!.getRows(HEAD_ROW + 1, 1000)!.find((r) => String(r.getCell(1).value).startsWith('Aaradhya'))!
    expect(long.getCell(1).alignment.wrapText).toBe(true)
    expect(long.height).toBeGreaterThan(15)
    expect(ms).toBeLessThan(60_000)
  }, 120_000)
})

describe('Word', () => {
  it('is a valid document with native charts, the figures, the tables and page numbers', async () => {
    const d = doc()
    const bytes = await wordDocument(d, new Uint8Array(readFileSync(join(__dirname, '..', 'logo.png'))))
    keep('report.docx', bytes)
    const zip = await JSZip.loadAsync(bytes)
    const xml = await zip.file('word/document.xml')!.async('string')
    expect(Object.keys(zip.files).filter((f) => /^word\/charts\/chart\d+\.xml$/.test(f))).toHaveLength(3)
    expect(xml).toContain('Key figures')
    expect(xml).toContain(d.tiles[0]!.value)
    expect(xml).toContain('Attendance register')
    expect(xml).toContain('w:orient="landscape"')
    const footer = Object.keys(zip.files).find((f) => /word\/footer\d*\.xml/.test(f))!
    expect(await zip.file(footer)!.async('string')).toMatch(/NUMPAGES/)
  })
})
