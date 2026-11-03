import ExcelJS from 'exceljs'
import { formatTime, indiaClock, toMinutes } from '../../../domain/time'
import { ATTENDANCE_LABEL, binRange, pct, timeOf, type Attendance, type GroupLine, type Row } from '../engine'
import { byProgrammeOrder } from '../../admin/programmeGroups'
import { stamp, type ReportDoc } from './doc'

/** The workbook's title on every sheet. */
export const TITLE = 'JUMPSTART GO — ATTENDANCE REPORT'
export const SHEETS = { summary: 'Executive Summary', detail: 'Detailed Attendance', programmes: 'Programme-wise Report', students: 'Student-wise Summary', notes: 'Notes' } as const

const NAVY = 'FF1D3461'
const INK = 'FF16213B'
const MUTED = 'FF5B6478'
const LINE = 'FFD5DBE5'
const BAND = 'FFF5F7FA'
const SOFT = 'FFE8EDF5'
const FONT = 'Arial'
const fill = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } })
const hair: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: LINE } }
const STATUS_INK: Partial<Record<Attendance, string>> = { late: 'FF9A5B00', absent: MUTED, not_recorded: 'FFA3361D' }

/** The row a sheet's table header sits on: title, sheet name, details, a blank row, then the header. */
const HEAD_ROW = 5

interface Col { header: string; width: number; align?: 'left' | 'right' | 'center'; fmt?: string; wrap?: boolean }

/**
 * Text goes in as a text cell, which Excel, Google Sheets and LibreOffice never evaluate, so a child's name starting
 * with "=" can't run as a formula. Control characters a spreadsheet can't show are dropped.
 */
const text = (v: string | null | undefined) => (v ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '') : null)

/** Title, sheet name and the report's details across the sheet's width; the table header styled on HEAD_ROW. */
function frame(ws: ExcelJS.Worksheet, d: ReportDoc, cols: Col[], subtitle: string, orientation: 'portrait' | 'landscape', table = true) {
  ws.columns = cols.map((c) => ({ width: c.width }))
  const last = cols.length
  const band = (row: number, value: string, font: Partial<ExcelJS.Font>, height: number) => {
    ws.mergeCells(row, 1, row, last)
    const c = ws.getCell(row, 1)
    c.value = value
    c.font = { name: FONT, ...font }
    c.alignment = { vertical: 'middle', horizontal: 'left' }
    ws.getRow(row).height = height
  }
  band(1, TITLE, { size: 16, bold: true, color: { argb: NAVY } }, 28)
  band(2, subtitle, { size: 12, bold: true, color: { argb: INK } }, 20)
  band(3, `${d.center}   ·   Reporting period: ${d.period}   ·   Generated: ${stamp(d.generatedAt)}`, { size: 9, color: { argb: MUTED } }, 16)
  ws.getRow(4).height = 8
  ws.pageSetup = {
    paperSize: 9, orientation, fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true,
    margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.6, header: 0.25, footer: 0.3 },
    ...(table ? { printTitlesRow: `${HEAD_ROW}:${HEAD_ROW}` } : {}),
  }
  ws.headerFooter.oddFooter = `&L&8Jumpstart Go · Attendance report&C&8&A&R&8Page &P of &N`
  if (!table) return
  const h = ws.getRow(HEAD_ROW)
  cols.forEach((c, i) => {
    const cell = h.getCell(i + 1)
    cell.value = c.header
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = fill(NAVY)
    cell.alignment = { vertical: 'middle', horizontal: c.align ?? 'left', wrapText: true }
    cell.border = { top: hair, bottom: hair, left: hair, right: hair }
  })
  h.height = 44
}

/** A table body row: band every other row, hairline borders, alignment and number formats from its column. */
function body(ws: ExcelJS.Worksheet, cols: Col[], values: Array<string | number | Date | null>, i: number, opts: { bold?: boolean; total?: boolean } = {}) {
  const r = ws.addRow(values)
  let lines = 1
  cols.forEach((c, j) => {
    const cell = r.getCell(j + 1)
    cell.font = { name: FONT, size: 10, bold: !!opts.bold, color: { argb: INK } }
    cell.alignment = { vertical: 'top', horizontal: c.align ?? 'left', wrapText: !!c.wrap }
    cell.border = opts.total ? { top: { style: 'medium', color: { argb: NAVY } }, bottom: hair } : { bottom: hair }
    if (c.fmt) cell.numFmt = c.fmt
    if (opts.total) cell.fill = fill(SOFT)
    else if (i % 2 === 1) cell.fill = fill(BAND)
    const v = values[j]
    // Wrapped text gets the rows it needs (about one character per width unit), so nothing is cut off or overlaps.
    if (c.wrap && typeof v === 'string') lines = Math.max(lines, Math.ceil(v.length / Math.max(1, c.width - 2)))
  })
  if (lines > 1) r.height = Math.min(4, lines) * 13 + 4
  return r
}

function finish(ws: ExcelJS.Worksheet, cols: Col[], xSplit = 0) {
  ws.views = [{ state: 'frozen', ySplit: HEAD_ROW, xSplit, topLeftCell: ws.getCell(HEAD_ROW + 1, xSplit + 1).address, showGridLines: false }]
  const lastRow = Math.max(HEAD_ROW, ws.rowCount)
  ws.autoFilter = { from: { row: HEAD_ROW, column: 1 }, to: { row: lastRow, column: cols.length } }
  ws.pageSetup.printArea = `A1:${ws.getColumn(cols.length).letter}${lastRow}`
}

const minutesOfIso = (iso: string | null) => (iso ? indiaClock(new Date(iso)).minutes : null)
const minutesOfHhmm = (s: string | null) => { try { return s ? toMinutes(s) : null } catch { return null } }
/** A time of day as Excel stores it, a fraction of a day, so it sorts and filters as a time. */
const asTime = (min: number | null) => (min === null ? null : min / 1440)
const verification = (verified: boolean, source: Row['dropoff_source'], has: boolean) =>
  !has ? null : verified ? (source === 'corrected' ? 'Corrected by admin' : 'Verified at gate') : source === 'expired' ? 'Over 30 days' : 'Not verified'
const rate = (v: number | null) => v

/**
 * The attendance workbook: Executive Summary, Detailed Attendance (when the register is included), Programme-wise
 * Report, Student-wise Summary and Notes. Every figure comes from the report document the dashboard and the PDFs use.
 * Totals are written as values, not formulas, so the file reads the same in every spreadsheet app and can't drift from
 * the on-screen report.
 */
export async function workbook(d: ReportDoc): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Jumpstart Go'
  wb.title = `Attendance report ${d.period}`
  wb.subject = d.reportId
  wb.created = new Date(d.generatedAt)

  summarySheet(wb, d)
  if (d.sections.register) detailSheet(wb, d)
  programmeSheet(wb, d)
  studentSheet(wb, d)
  notesSheet(wb, d)
  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>
}

function summarySheet(wb: ExcelJS.Workbook, d: ReportDoc) {
  const ws = wb.addWorksheet(SHEETS.summary, { properties: { tabColor: { argb: NAVY } } })
  const cols: Col[] = [{ header: 'Measure', width: 40 }, { header: 'Value', width: 16 }, { header: 'Detail', width: 16 }, { header: '', width: 16 }, { header: '', width: 18 }]
  // A page of sections, not one table.
  frame(ws, d, cols, SHEETS.summary, 'portrait', false)

  const k = d.kpis
  const n = (v: number) => v
  const students = new Set(d.rows.map((r) => r.child_id)).size
  const announced = d.rows.filter((r) => r.pickup_announced_at).length

  const section = (title: string) => {
    ws.addRow([])
    const r = ws.addRow([title])
    ws.mergeCells(r.number, 1, r.number, cols.length)
    const c = r.getCell(1)
    c.font = { name: FONT, size: 11, bold: true, color: { argb: 'FFFFFFFF' } }
    c.fill = fill(NAVY)
    c.alignment = { vertical: 'middle', indent: 1 }
    r.height = 22
  }
  let band = 0
  const line = (label: string, value: string | number | null, detail = '', fmt?: string) => {
    const r = ws.addRow([label, value, detail || null])
    // Without a detail the value takes the rest of the row, so a long one (the centre, the period) is never cut off.
    ws.mergeCells(r.number, detail ? 3 : 2, r.number, cols.length)
    r.getCell(1).font = { name: FONT, size: 10, color: { argb: MUTED } }
    r.getCell(1).alignment = { vertical: 'top', indent: 1 }
    r.getCell(2).font = { name: FONT, size: 10, bold: true, color: { argb: INK } }
    r.getCell(2).alignment = { vertical: 'top', horizontal: typeof value === 'number' || detail ? 'right' : 'left' }
    if (fmt) r.getCell(2).numFmt = fmt
    r.getCell(3).font = { name: FONT, size: 9, color: { argb: MUTED } }
    r.getCell(3).alignment = { vertical: 'top', wrapText: true }
    for (let c = 1; c <= cols.length; c++) {
      r.getCell(c).border = { bottom: hair }
      if (band % 2 === 1) r.getCell(c).fill = fill(BAND)
    }
    if (detail.length > 60) r.height = Math.ceil(detail.length / 60) * 13 + 4
    band++
  }

  section('Report details')
  band = 0
  line('Centre', text(d.center))
  line('Reporting period', text(d.period))
  line('Scope', text(d.scope))
  line('Data cutoff', text(d.cutoff))
  line('Generated', stamp(d.generatedAt))
  if (d.reportId) line('Report ID', d.reportId)
  line('Classification', 'Confidential: contains children\'s attendance')

  section('Enrolment')
  band = 0
  line('Students in this report', n(students), 'Expected on at least one day of the period, or with a record', '#,##0')
  line('Programmes', n(d.programmes.length), 'Each student counted once, under their main programme', '#,##0')
  for (const p of d.programmes) line(`   ${p.name}`, n(p.students), `${pct(p.rate)} attendance`, '#,##0')

  section('Attendance')
  band = 0
  line('Attendance rate', rate(k.attendanceRate), '(Present + Late) ÷ (Present + Late + Absent)', '0.0%')
  line('Present days', n(k.counts.present + k.counts.late), `Includes ${k.counts.late} late arrivals`, '#,##0')
  line('Absent days', n(k.counts.absent), 'Marked absent or on leave', '#,##0')
  line('Not recorded', n(k.counts.notRecorded), 'Expected, with no attendance record (not counted as absent)', '#,##0')
  line('Record coverage', rate(k.coverage), 'Due child-days that have a record', '0.0%')
  line('Incomplete records', n(k.incomplete), `${k.notRecorded} not recorded · ${k.missingVerification} without a verified drop-off or pickup`, '#,##0')

  section('Pickup and drop-off')
  band = 0
  line('Verified drop-offs', n(k.verifiedDropoffs), 'Checked in at the gate, or corrected by the admin', '#,##0')
  line('Verified pickups', n(k.verifiedPickups), 'Handed over at the gate, or corrected by the admin', '#,##0')
  line('Late arrivals', n(k.lateArrivals), 'Verified, more than 10 minutes after the scheduled time', '#,##0')
  line('Late pickups', n(k.latePickups), 'Verified, more than 10 minutes after the scheduled time', '#,##0')
  line('Average arrival', timeOf(k.avgArrivalMin), 'Mean time of verified drop-offs (IST)')
  line('Busiest half hour', d.gate.busiest ? binRange(d.gate.busiest) : '—', d.gate.busiest ? `${d.gate.busiest.dropoffs + d.gate.busiest.pickups} verified drop-offs and pickups` : 'No verified gate events')
  line('Parent pickup announcements', n(announced), "\"On my way\" and \"I've arrived\": announcements, never counted as attendance", '#,##0')

  section('Key observations')
  const obs = d.insights.length ? d.insights : ['Not enough recorded data in this period for an observation.']
  for (const o of obs) {
    const r = ws.addRow([text(`•  ${o}`)])
    ws.mergeCells(r.number, 1, r.number, cols.length)
    r.getCell(1).font = { name: FONT, size: 10, color: { argb: INK } }
    r.getCell(1).alignment = { vertical: 'top', wrapText: true, indent: 1 }
    r.height = Math.ceil(o.length / 95) * 14 + 4
  }

  ws.views = [{ showGridLines: false }]
  ws.pageSetup.printArea = `A1:E${ws.rowCount}`
}

function detailSheet(wb: ExcelJS.Workbook, d: ReportDoc) {
  const ws = wb.addWorksheet(SHEETS.detail)
  const names = d.sections.names
  const cols: Col[] = [
    { header: 'Date', width: 13, fmt: 'dd mmm yyyy' },
    { header: 'Student', width: 30, wrap: true },
    { header: 'Programme', width: 28, wrap: true },
    { header: 'Class', width: 14, wrap: true },
    { header: 'Attendance status', width: 15 },
    { header: 'Drop-off time', width: 13, align: 'right', fmt: 'h:mm AM/PM' },
    { header: 'Drop-off verification', width: 18 },
    { header: 'Pickup time', width: 13, align: 'right', fmt: 'h:mm AM/PM' },
    { header: 'Pickup verification', width: 18 },
    { header: 'Scheduled arrival', width: 14, align: 'right', fmt: 'h:mm AM/PM' },
    { header: 'Scheduled departure', width: 14, align: 'right', fmt: 'h:mm AM/PM' },
    { header: 'Parent announced pickup', width: 15, align: 'right', fmt: 'h:mm AM/PM' },
    { header: 'Late arrival (min)', width: 12, align: 'right', fmt: '0' },
    { header: 'Late pickup (min)', width: 12, align: 'right', fmt: '0' },
    { header: 'Exceptions', width: 34, wrap: true },
    ...(names ? [{ header: 'Collected by', width: 22, wrap: true }, { header: 'Recorded by', width: 22, wrap: true }] : []),
    ...(d.sections.notes ? [{ header: 'Note', width: 34, wrap: true }] : []),
  ]
  frame(ws, d, cols, SHEETS.detail, 'landscape')
  const rows = [...d.rows].sort((a, b) => a.day.localeCompare(b.day) || byProgrammeOrder(a.programme, b.programme) || a.child.localeCompare(b.child, 'en-IN'))
  rows.forEach((r, i) => {
    const row = body(ws, cols, [
      new Date(`${r.day}T00:00:00Z`), text(r.child), text(r.programme), text(r.class), ATTENDANCE_LABEL[r.attendance],
      asTime(r.dropoffMin), verification(r.dropoffVerified, r.dropoff_source, r.dropoff_at !== null),
      asTime(r.pickupMin), verification(r.pickupVerified, r.pickup_source, r.pickup_at !== null),
      asTime(minutesOfHhmm(r.sched_in)), asTime(minutesOfHhmm(r.sched_out)), asTime(minutesOfIso(r.pickup_announced_at)),
      r.lateArrivalMin, r.latePickupMin, text(r.issues.join('; ')) || null,
      ...(names ? [text(r.pickup_to), text([r.dropoff_by, r.pickup_by].filter(Boolean).join(' / ')) || null] : []),
      ...(d.sections.notes ? [text(r.note)] : []),
    ], i)
    const ink = STATUS_INK[r.attendance]
    if (ink) row.getCell(5).font = { name: FONT, size: 10, bold: true, color: { argb: ink } }
    if (r.issues.length) row.getCell(15).font = { name: FONT, size: 10, color: { argb: 'FFA3361D' } }
  })
  if (!rows.length) emptyRow(ws, cols, 'No attendance records match this report: no student was expected and nothing was recorded in this period.')
  finish(ws, cols, 2)
}

const groupValues = (g: GroupLine) => [g.students, g.due, g.present, g.late, g.absent, g.notRecorded, rate(g.rate), g.latePickups, g.incomplete]
const GROUP_COLS: Col[] = [
  { header: 'Students', width: 12, align: 'right', fmt: '#,##0' },
  { header: 'Due days', width: 12, align: 'right', fmt: '#,##0' },
  { header: 'Present days', width: 12, align: 'right', fmt: '#,##0' },
  { header: 'of which late', width: 12, align: 'right', fmt: '#,##0' },
  { header: 'Absent days', width: 12, align: 'right', fmt: '#,##0' },
  { header: 'Not recorded', width: 12, align: 'right', fmt: '#,##0' },
  { header: 'Attendance rate', width: 12, align: 'right', fmt: '0.0%' },
  { header: 'Late pickups', width: 12, align: 'right', fmt: '#,##0' },
  { header: 'Incomplete records', width: 12, align: 'right', fmt: '#,##0' },
]

function programmeSheet(wb: ExcelJS.Workbook, d: ReportDoc) {
  const ws = wb.addWorksheet(SHEETS.programmes)
  const cols: Col[] = [{ header: 'Programme', width: 34, wrap: true }, ...GROUP_COLS]
  frame(ws, d, cols, SHEETS.programmes, 'landscape')
  d.programmes.forEach((p, i) => body(ws, cols, [text(p.name), ...groupValues(p)], i))
  if (d.programmes.length) {
    const k = d.kpis
    const c = k.counts
    const total = body(ws, cols, ['All programmes', new Set(d.rows.map((r) => r.child_id)).size, c.present + c.late + c.absent + c.notRecorded, c.present + c.late, c.late, c.absent, c.notRecorded, rate(k.attendanceRate), k.latePickups, k.incomplete], 0, { bold: true, total: true })
    total.getCell(1).alignment = { vertical: 'top', horizontal: 'left' }
  } else emptyRow(ws, cols, 'No students in this report.')
  finish(ws, cols, 1)
  // The total row stays under the table, outside the filter range, so filtering never hides it or mixes it in.
  if (d.programmes.length) ws.autoFilter = { from: { row: HEAD_ROW, column: 1 }, to: { row: ws.rowCount - 1, column: cols.length } }
}

function studentSheet(wb: ExcelJS.Workbook, d: ReportDoc) {
  const ws = wb.addWorksheet(SHEETS.students)
  const cols: Col[] = [
    { header: 'Student', width: 30, wrap: true }, { header: 'Programme', width: 28, wrap: true }, { header: 'Class', width: 14, wrap: true },
    ...GROUP_COLS.slice(1),
    { header: 'Late arrivals', width: 12, align: 'right', fmt: '#,##0' },
  ]
  frame(ws, d, cols, SHEETS.students, 'landscape')
  d.students.forEach((s, i) => body(ws, cols, [text(s.name), text(s.programme), text(s.class), ...groupValues(s).slice(1), s.lateArrivals], i))
  if (!d.students.length) emptyRow(ws, cols, 'No students in this report.')
  finish(ws, cols, 1)
}

function emptyRow(ws: ExcelJS.Worksheet, cols: Col[], message: string) {
  const r = ws.addRow([message])
  ws.mergeCells(r.number, 1, r.number, cols.length)
  r.getCell(1).font = { name: FONT, size: 10, italic: true, color: { argb: MUTED } }
  r.getCell(1).alignment = { vertical: 'middle', horizontal: 'center' }
  r.height = 28
}

function notesSheet(wb: ExcelJS.Workbook, d: ReportDoc) {
  const ws = wb.addWorksheet(SHEETS.notes)
  const cols: Col[] = [{ header: 'Term', width: 28 }, { header: 'Meaning', width: 100, wrap: true }]
  frame(ws, d, cols, 'Notes and definitions', 'landscape')
  const defs: Array<[string, string]> = [
    ['Attendance rate', '(Present + Late) ÷ (Present + Late + Absent), over child-days with a record.'],
    ['Present', 'Checked in at the gate, marked present, or given a drop-off or pickup time by the admin.'],
    ['Late', 'A verified drop-off more than 10 minutes after the scheduled time. Late days are also counted as present.'],
    ['Absent', 'Marked absent or on leave.'],
    ['Not recorded', 'Expected (enrolled, programme running, not a holiday) but with no attendance record. Never counted as absent.'],
    ['Verified drop-off / pickup', "A coordinator's Check in or Hand over at the gate (a pickup only to a registered guardian, or to a collector with their code), or an admin's correction with a reason."],
    ['Parent announcements', '"On my way", "I\'ve arrived" and the gate\'s Ready are announcements. They are shown for reference and never count as attendance.'],
    ['Incomplete', 'Present, but without a verified drop-off or pickup (today: still on campus is not incomplete).'],
    ['Over 30 days', 'Gate details are kept for 30 days: earlier days keep their recorded times only, so they are neither verified, incomplete nor late.'],
    ['Programme', "The student's main programme. Each student is counted under one programme, so the programme-wise lines add up to the whole report."],
    ['Expected days', "Worked out from each child's current programmes, terms and regular times: a change made since also applies to earlier days in this report."],
    ['Times', `India Standard Time (Asia/Kolkata). Report read at ${formatTime(indiaClock(new Date(d.generatedAt)).minutes)} IST.`],
  ]
  defs.forEach(([a, b], i) => body(ws, cols, [a, b], i).getCell(1).font = { name: FONT, size: 10, bold: true, color: { argb: INK } })
  ws.views = [{ state: 'frozen', ySplit: HEAD_ROW, showGridLines: false }]
  ws.pageSetup.printArea = `A1:B${ws.rowCount}`
}
