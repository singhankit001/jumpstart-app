import { jsPDF } from 'jspdf'
import { barChart, lineChart, type Box, type ChartModel } from '../charts'
import { formatTime } from '../../../domain/time'
import { ATTENDANCE_LABEL, BIN_MIN, dayLabel, LATE_MIN, pct, type Row } from '../engine'
import { busiestNote, stamp, type ReportDoc } from './doc'

/** The embedded typeface (Plus Jakarta Sans, OFL) as base64 TTFs, and the school's logo as PNG bytes. */
export interface PdfAssets { regular: string; semibold: string; bold: string; logo: Uint8Array }

// A4 landscape, in millimetres.
const W = 297
const H = 210
const M = 12
const INK = '#16213b'
const INK2 = '#4a5470'
const MUTED = '#7a8299'
const LINE = '#dfe3ec'
const TILE = '#f3f5f9'

function start(a: PdfAssets, d: ReportDoc, title: string): jsPDF {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true })
  doc.addFileToVFS('PJS-Regular.ttf', a.regular)
  doc.addFileToVFS('PJS-SemiBold.ttf', a.semibold)
  doc.addFileToVFS('PJS-ExtraBold.ttf', a.bold)
  doc.addFont('PJS-Regular.ttf', 'PJS', 'normal')
  doc.addFont('PJS-SemiBold.ttf', 'PJS', 'semibold')
  doc.addFont('PJS-ExtraBold.ttf', 'PJS', 'bold')
  doc.setFont('PJS', 'normal')
  doc.setProperties({
    title: `${title} · ${d.period}`, subject: `Attendance Intelligence · ${d.center}`, author: 'JumpStart Go', creator: 'JumpStart Go',
    keywords: `attendance, ${d.reportId}, confidential`,
  })
  return doc
}

const font = (doc: jsPDF, style: 'normal' | 'semibold' | 'bold', size: number, color = INK) => {
  doc.setFont('PJS', style)
  doc.setFontSize(size)
  doc.setTextColor(color)
}
/** The text cut with an ellipsis to fit the width: nothing ever runs past its box. */
export function fit(doc: jsPDF, text: string, width: number): string {
  if (doc.getTextWidth(text) <= width) return text
  let s = text
  while (s.length > 1 && doc.getTextWidth(`${s}…`) > width) s = s.slice(0, -1)
  return `${s.trimEnd()}…`
}
/** At most `lines` lines in the width, the last cut with an ellipsis. */
function wrap(doc: jsPDF, text: string, width: number, lines: number): string[] {
  const all = doc.splitTextToSize(text, width) as string[]
  if (all.length <= lines) return all
  const kept = all.slice(0, lines)
  kept[lines - 1] = fit(doc, `${kept[lines - 1]} ${all.slice(lines).join(' ')}`, width)
  return kept
}

function header(doc: jsPDF, a: PdfAssets, d: ReportDoc, title: string) {
  const logoW = 34
  doc.addImage(a.logo, 'PNG', M, M, logoW, (logoW * 136) / 420)
  doc.setDrawColor(LINE)
  doc.setLineWidth(0.3)
  doc.line(M + logoW + 5, M + 0.5, M + logoW + 5, M + 11)
  const x = M + logoW + 10
  const right = W - M
  font(doc, 'semibold', 8, d.theme.accent)
  doc.text('JumpStart Go · Attendance Intelligence', x, M + 3, { baseline: 'top' })
  font(doc, 'bold', 17)
  doc.text(title, x, M + 7.5, { baseline: 'top' })
  const leftEnd = x + Math.max(doc.getTextWidth(title), 60)
  font(doc, 'normal', 8, INK2)
  doc.text(fit(doc, d.center, right - x - 90), x, M + 16, { baseline: 'top' })
  // The right block never meets the title: whatever room is left, at most 95 mm.
  const room = Math.min(95, right - leftEnd - 6)
  font(doc, 'normal', 6.5, MUTED)
  doc.text('REPORTING PERIOD', right, M + 2.5, { align: 'right', baseline: 'top' })
  font(doc, 'semibold', 9.5)
  doc.text(fit(doc, d.period, room), right, M + 6, { align: 'right', baseline: 'top' })
  font(doc, 'normal', 7, INK2)
  doc.text(fit(doc, d.scope, room), right, M + 11, { align: 'right', baseline: 'top' })
  doc.text(fit(doc, `Generated ${stamp(d.generatedAt)}`, room), right, M + 15, { align: 'right', baseline: 'top' })
  doc.setDrawColor(LINE)
  doc.line(M, M + 21, right, M + 21)
}

function footer(doc: jsPDF, d: ReportDoc, page: number, pages: number) {
  const y = H - 9
  doc.setDrawColor(LINE)
  doc.setLineWidth(0.3)
  doc.line(M, y - 3, W - M, y - 3)
  const right = `CONFIDENTIAL · Page ${page} of ${pages}`
  font(doc, 'bold', 6.5, d.theme.accent)
  const rw = doc.getTextWidth(right)
  doc.text(right, W - M, y, { align: 'right', baseline: 'top' })
  font(doc, 'normal', 6.5, MUTED)
  const left = `Reporting period: ${d.period}  ·  Report ID: ${d.reportId}  ·  Data cutoff: ${d.cutoff}  ·  Generated ${stamp(d.generatedAt)}`
  doc.text(fit(doc, left, W - 2 * M - rw - 8), M, y, { baseline: 'top' })
}

function tile(doc: jsPDF, b: Box, label: string, value: string, detail: string, accent: string) {
  doc.setFillColor(TILE)
  doc.roundedRect(b.x, b.y, b.w, b.h, 2.5, 2.5, 'F')
  doc.setFillColor(accent)
  doc.roundedRect(b.x, b.y + 4, 1.2, b.h - 8, 0.6, 0.6, 'F')
  font(doc, 'semibold', 6.5, MUTED)
  doc.text(fit(doc, label.toUpperCase(), b.w - 8), b.x + 4.5, b.y + 3.6, { baseline: 'top' })
  font(doc, 'bold', value.length > 7 ? 14 : 18)
  doc.text(fit(doc, value, b.w - 8), b.x + 4.5, b.y + 8.6, { baseline: 'top' })
  // A step smaller before anything is cut.
  font(doc, 'normal', 6.5, INK2)
  if (doc.getTextWidth(detail) > b.w - 8) doc.setFontSize(5.8)
  doc.text(fit(doc, detail, b.w - 8), b.x + 4.5, b.y + b.h - 6, { baseline: 'top' })
}

/** Draws a chart model: hairline grid, axis labels in muted ink, bars with a rounded data end, a 0.6 mm line. */
function drawChart(doc: jsPDF, m: ChartModel, colors: readonly string[], highlight?: number) {
  doc.setLineWidth(0.2)
  doc.setDrawColor(LINE)
  font(doc, 'normal', 5.8, MUTED)
  for (const t of m.ticks) {
    doc.line(m.plot.x, t.y, m.plot.x + m.plot.w, t.y)
    doc.text(t.label, m.plot.x - 1.5, t.y, { align: 'right', baseline: 'middle' })
  }
  for (const l of m.xLabels) doc.text(l.label, l.x, m.plot.y + m.plot.h + 2, { align: 'center', baseline: 'top' })
  if (highlight !== undefined && m.slots[highlight]) {
    const s = m.slots[highlight]!
    doc.setFillColor('#eef1f7')
    doc.rect(s.x, m.plot.y, s.w, m.plot.h, 'F')
  }
  for (const b of m.bars) {
    doc.setFillColor(colors[b.series]!)
    const r = Math.min(0.8, b.w / 2, b.h)
    if (b.h > r * 2) {
      doc.roundedRect(b.x, b.y, b.w, b.h, r, r, 'F')
      doc.rect(b.x, b.y + b.h - r, b.w, r, 'F')
    } else doc.rect(b.x, b.y, b.w, b.h, 'F')
  }
  if (m.line) {
    doc.setDrawColor(colors[0]!)
    doc.setLineWidth(0.6)
    doc.setLineJoin('round')
    doc.setLineCap('round')
    for (const s of m.line.segments) for (let i = 1; i < s.length; i++) doc.line(s[i - 1]![0], s[i - 1]![1], s[i]![0], s[i]![1])
    doc.setLineWidth(0.5)
    doc.setDrawColor('#ffffff')
    doc.setFillColor(colors[0]!)
    for (const p of m.line.dots) doc.circle(p.x, p.y, m.line.dots.length > 20 ? 0.6 : 0.9, 'FD')
  }
}

function card(doc: jsPDF, b: Box, title: string, subtitle: string) {
  doc.setDrawColor(LINE)
  doc.setLineWidth(0.3)
  doc.roundedRect(b.x, b.y, b.w, b.h, 2.5, 2.5, 'S')
  font(doc, 'bold', 9)
  doc.text(fit(doc, title, b.w - 8), b.x + 4, b.y + 3.8, { baseline: 'top' })
  font(doc, 'normal', 6.2, INK2)
  doc.text(fit(doc, subtitle, b.w - 8), b.x + 4, b.y + 8.4, { baseline: 'top' })
}
function legend(doc: jsPDF, x: number, y: number, names: readonly string[], colors: readonly string[]) {
  font(doc, 'semibold', 6.2, INK2)
  let cx = x
  names.forEach((n, i) => {
    doc.setFillColor(colors[i]!)
    doc.roundedRect(cx, y - 1.1, 2.2, 2.2, 0.5, 0.5, 'F')
    doc.text(n, cx + 3.2, y, { baseline: 'middle' })
    cx += 3.2 + doc.getTextWidth(n) + 5
  })
}
function emptyChart(doc: jsPDF, b: Box, text: string) {
  doc.setFillColor(TILE)
  doc.roundedRect(b.x, b.y, b.w, b.h, 2, 2, 'F')
  font(doc, 'semibold', 7.5, INK2)
  doc.text(text, b.x + b.w / 2, b.y + b.h / 2, { align: 'center', baseline: 'middle' })
}

/** A4 landscape, exactly one page: header, six KPIs, three charts, insights and exceptions, footer. */
export function executivePdf(d: ReportDoc, a: PdfAssets): ArrayBuffer {
  const title = 'Executive Summary'
  const doc = start(a, d, title)
  header(doc, a, d, title)
  const colors = d.theme.series

  // Six KPIs.
  const kTop = M + 25
  const kH = 24
  const kW = (W - 2 * M - 5 * 4) / 6
  d.tiles.forEach((t, i) => tile(doc, { x: M + i * (kW + 4), y: kTop, w: kW, h: kH }, t.label, t.value, t.detail, d.theme.accent))

  // Three charts.
  const cTop = kTop + kH + 5
  const cH = 79
  const cW = (W - 2 * M - 2 * 5) / 3
  const box = (i: number): Box => ({ x: M + i * (cW + 5) + 3, y: cTop + 17, w: cW - 6, h: cH - 20 })
  const cats = d.points.map((p) => p.label)
  const labels = cats.length > 16 ? 5 : 7

  card(doc, { x: M, y: cTop, w: cW, h: cH }, 'Attendance trend', `${d.grainWord} attendance rate: present and late of recorded child-days`)
  const rates = d.points.map((p) => p.rate)
  if (rates.some((r) => r !== null)) drawChart(doc, lineChart({ box: box(0), categories: cats, values: rates, maxLabels: labels, yLabelW: 9, axisH: 6 }), colors)
  else emptyChart(doc, box(0), 'No recorded attendance in this period')

  card(doc, { x: M + cW + 5, y: cTop, w: cW, h: cH }, 'Pickup vs drop-off activity', `${d.grainWord} verified events (gate or admin correction)`)
  legend(doc, M + cW + 5 + 4, cTop + 14, ['Drop-offs', 'Pickups'], colors)
  if (d.kpis.verifiedDropoffs + d.kpis.verifiedPickups) {
    drawChart(doc, barChart({ box: box(1), categories: cats, series: [d.points.map((p) => p.dropoffs), d.points.map((p) => p.pickups)], maxLabels: labels, yLabelW: 7, axisH: 6, maxBar: 4, gap: 0.4 }), colors)
  } else emptyChart(doc, box(1), 'No verified drop-offs or pickups')

  card(doc, { x: M + 2 * (cW + 5), y: cTop, w: cW, h: cH }, 'Peak gate activity', `Verified events per ${BIN_MIN} minutes (IST) · ${busiestNote(d)}`)
  legend(doc, M + 2 * (cW + 5) + 4, cTop + 14, ['Arrivals', 'Departures'], colors)
  if (d.gate.busiest) {
    const bins = d.gate.bins
    const hourly = bins.map((b) => (b.from % 120 === 0 ? `${((b.from / 60 + 11) % 12) + 1} ${b.from < 720 ? 'AM' : 'PM'}` : ''))
    const m = barChart({ box: box(2), categories: hourly, series: [bins.map((b) => b.dropoffs), bins.map((b) => b.pickups)], stacked: true, maxLabels: bins.length, yLabelW: 7, axisH: 6, maxBar: 4, gap: 0.3 })
    m.xLabels = m.xLabels.filter((l) => l.label)
    drawChart(doc, m, colors, bins.indexOf(d.gate.busiest))
  } else emptyChart(doc, box(2), 'No verified gate events')

  // Insights and exceptions.
  const bTop = cTop + cH + 5
  const bH = H - 13 - bTop - 3
  const iW = 168
  card(doc, { x: M, y: bTop, w: iW, h: bH }, 'Management insights', 'From the figures in this report only')
  font(doc, 'normal', 7.6)
  let y = bTop + 14
  const list = d.insights.length ? d.insights : ['Not enough recorded data in this period for an observation.']
  for (const text of list) {
    const lines = wrap(doc, text, iW - 14, 2)
    doc.setFillColor(d.theme.accent)
    doc.circle(M + 5.2, y + 1.3, 0.7, 'F')
    font(doc, 'normal', 7.6)
    doc.text(lines, M + 8, y, { baseline: 'top', lineHeightFactor: 1.3 })
    y += lines.length * 3.6 + 2.2
  }
  const eX = M + iW + 5
  const eW = W - M - eX
  card(doc, { x: eX, y: bTop, w: eW, h: bH }, 'Exceptions summary', `${d.exceptions.length} child-days need attention`)
  const lines: Array<[string, number]> = [
    ['No attendance record', d.kpis.notRecorded],
    ['Missing verified drop-off or pickup', d.kpis.missingVerification],
    ['Late pickups', d.kpis.latePickups],
    ['Late arrivals', d.kpis.lateArrivals],
  ]
  y = bTop + 13.5
  for (const [label, n] of lines) {
    font(doc, 'normal', 7.2, INK2)
    doc.text(fit(doc, label, eW - 22), eX + 4, y, { baseline: 'top' })
    font(doc, 'bold', 7.2)
    doc.text(String(n), eX + eW - 4, y, { align: 'right', baseline: 'top' })
    y += 3.9
  }
  const recent = d.exceptions.slice(0, 2)
  if (recent.length) {
    doc.setDrawColor(LINE)
    doc.line(eX + 4, y + 0.3, eX + eW - 4, y + 0.3)
    y += 1.8
    font(doc, 'normal', 6.4, MUTED)
    for (const r of recent) {
      doc.text(fit(doc, `${dayLabel(r.day)} · ${r.child} · ${r.issues[0]}`, eW - 8), eX + 4, y, { baseline: 'top' })
      y += 3.2
    }
  }
  footer(doc, d, 1, 1)
  return doc.output('arraybuffer')
}

// The detailed register: a summary, the classes compared, then each class's rows, as many A4 landscape pages as it takes --

/** "9:05 AM", the same clock as the dashboard; null when there is no time. */
const clock = (min: number | null) => (min === null ? null : formatTime(min))
const duration = (r: Row) => {
  if (r.dropoffMin === null || r.pickupMin === null || r.pickupMin < r.dropoffMin) return '—'
  const m = r.pickupMin - r.dropoffMin
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}
const came = (r: Row) => r.attendance === 'present' || r.attendance === 'late'
/** The check-out cell: the time, or why there is none. A child dropped off and not collected is never shown as gone. */
const checkOut = (r: Row) => clock(r.pickupMin) ?? (came(r) && r.dropoffMin !== null ? (r.record === 'on_campus' ? 'On campus' : 'Not checked out') : '—')
const tag = (verified: boolean, s: Row['dropoff_source']) => (s === null || verified ? '' : s === 'expired' ? ' (over 30 days)' : ' (not verified)')

interface RegCol { label: string; w: number; align?: 'right'; value: (r: Row) => string; tone?: (r: Row) => string | null }
function registerColumns(d: ReportDoc, oneDay: boolean): RegCol[] {
  const cols: RegCol[] = [
    { label: 'Student', w: 52, value: (r) => r.child },
    ...(oneDay ? [] : [{ label: 'Date', w: 24, value: (r: Row) => dayLabel(r.day) }]),
    { label: 'Check-in', w: 32, value: (r) => (clock(r.dropoffMin) ?? '—') + tag(r.dropoffVerified, r.dropoff_source) },
    { label: 'Check-out', w: 32, value: (r) => checkOut(r) + (r.pickupMin === null ? '' : tag(r.pickupVerified, r.pickup_source)), tone: (r) => (checkOut(r) === 'Not checked out' ? WARN : null) },
    { label: 'Duration', w: 18, align: 'right', value: duration },
    { label: 'Status', w: 24, value: (r) => ATTENDANCE_LABEL[r.attendance], tone: (r) => (r.attendance === 'not_recorded' ? WARN : r.attendance === 'late' ? WARN : null) },
    { label: 'Exceptions', w: 60, value: (r) => r.issues.join('; ') || '—', tone: (r) => (r.issues.length ? WARN : null) },
  ]
  if (d.sections.names) cols.splice(6, 0, { label: 'Recorded by', w: 34, value: (r) => [r.dropoff_by, r.pickup_by].filter(Boolean).join(' / ') || '—' })
  if (d.sections.notes) cols.push({ label: 'Note', w: 40, value: (r) => r.note ?? '—' })
  return cols
}
const WARN = '#a3361d'

export function detailedPdf(d: ReportDoc, a: PdfAssets): ArrayBuffer {
  const title = 'Attendance Register'
  const doc = start(a, d, title)
  const top = M + 25
  const bottom = H - 15
  const fullW = W - 2 * M
  // A one-day report says its date once, in the header.
  const oneDay = new Set(d.rows.map((r) => r.day)).size <= 1
  const cols = registerColumns(d, oneDay)
  const scale = fullW / cols.reduce((s, c) => s + c.w, 0)
  const pad = 2
  const lineH = 3.3
  let y = top

  const newPage = () => { doc.addPage(); header(doc, a, d, title); y = top }
  const need = (h: number) => { if (y + h > bottom) newPage() }
  const label = (text: string) => { font(doc, 'semibold', 7, MUTED); doc.text(text.toUpperCase(), M, y, { baseline: 'top' }); y += 5 }

  header(doc, a, d, title)

  // 1. Summary: only figures the rows can give. An empty report shows no figures at all, rather than a row of zeros.
  if (d.sections.kpis && d.rows.length) {
    const k = d.kpis
    const students = new Set(d.rows.map((r) => r.child_id)).size
    const days = d.rows.length
    const completed = d.rows.filter((r) => came(r) && r.pickupMin !== null).length
    const n = (v: number) => v.toLocaleString('en-IN')
    const one = oneDay
    const unit = one ? 'students' : 'child-days'
    const tiles: Array<[string, string, string]> = [
      ['Students in scope', n(students), one ? 'Expected or recorded that day' : `${n(days)} child-days in the period`],
      ['Present', n(k.counts.present + k.counts.late), 'Checked in or marked present'],
      ['Confirmed absent', n(k.counts.absent), 'Marked absent or on leave'],
      ['Late arrivals', n(k.lateArrivals), `Verified, over ${LATE_MIN} min after schedule`],
      ['Completed check-outs', n(completed), `of ${n(k.counts.present + k.counts.late)} present ${unit}`],
      ['Incomplete records', n(k.incomplete), `${n(k.notRecorded)} not recorded · ${n(k.missingVerification)} not verified`],
    ]
    label('Summary')
    const tW = (fullW - 5 * 3) / 6
    tiles.forEach(([l, v, det], i) => tile(doc, { x: M + i * (tW + 3), y, w: tW, h: 21 }, l, v, det, d.theme.accent))
    y += 21 + 7
  }

  // 2. The classes compared, when there is more than one.
  const compare = (title: string, first: string, lines: string[][]) => {
    const cc: Array<[string, number, 'right' | undefined]> = [[first, 70, undefined], ['Students', 24, 'right'], ['Present', 24, 'right'], ['Absent', 24, 'right'], ['Late arrivals', 28, 'right'], ['Not recorded', 28, 'right'], ['Incomplete', 26, 'right'], ['Attendance', 26, 'right']]
    const k2 = fullW / cc.reduce((s, c) => s + c[1], 0)
    for (const c of cc) c[1] *= k2
    need(5 + 6 + 5.5 * 2)
    label(title)
    const head = () => {
      doc.setFillColor(TILE); doc.rect(M, y, fullW, 6, 'F')
      font(doc, 'semibold', 6.8, INK2)
      let x = M
      for (const [l, w, al] of cc) { doc.text(l, al ? x + w - pad : x + pad, y + 3, { baseline: 'middle', align: al ?? 'left' }); x += w }
      y += 6
    }
    head()
    for (const vals of lines) {
      need(5.5)
      if (y === top) head()
      font(doc, 'normal', 7.2)
      let x = M
      cc.forEach(([, w, al], i) => { doc.text(fit(doc, vals[i]!, w - 2 * pad), al ? x + w - pad : x + pad, y + 2.75, { baseline: 'middle', align: al ?? 'left' }); x += w })
      doc.setDrawColor(LINE); doc.setLineWidth(0.2); doc.line(M, y + 5.5, M + fullW, y + 5.5)
      y += 5.5
    }
    y += 7
  }
  if (d.classes.length > 1) {
    compare('By class', 'Class', d.classes.map((c) => {
      const list = d.rows.filter((r) => r.class_id === c.classId)
      return [c.name, String(new Set(list.map((r) => r.child_id)).size), String(c.present), String(list.filter((r) => r.attendance === 'absent').length),
        String(list.filter((r) => r.lateArrivalMin !== null).length), String(list.filter((r) => r.attendance === 'not_recorded').length), String(c.incomplete), pct(c.rate)]
    }))
  }

  // 3. Each class: a heading, the column header (again on every page it continues to), then whole rows only.
  const groups = d.classes.length ? d.classes : []
  const colHead = () => {
    doc.setFillColor(TILE); doc.rect(M, y, fullW, 6.5, 'F')
    font(doc, 'semibold', 6.8, INK2)
    let x = M
    for (const c of cols) { const w = c.w * scale; doc.text(c.label, c.align ? x + w - pad : x + pad, y + 3.25, { baseline: 'middle', align: c.align ?? 'left' }); x += w }
    y += 6.5
  }
  const classHead = (name: string, students: number, more: boolean) => {
    font(doc, 'bold', 10)
    doc.text(fit(doc, name, fullW - 60), M, y, { baseline: 'top' })
    font(doc, 'normal', 7.5, INK2)
    doc.text(`${students} ${students === 1 ? 'student' : 'students'}${more ? ' · continued' : ''}`, W - M, y + 0.8, { align: 'right', baseline: 'top' })
    y += 6
    colHead()
  }
  // Every cell's lines, so a row's height is its tallest cell: long names wrap to two lines, never run into the next column.
  const cells = (r: Row) => cols.map((c) => {
    const w = c.w * scale - 2 * pad
    font(doc, c.label === 'Student' ? 'semibold' : 'normal', 7.2)
    return wrap(doc, c.value(r), w, c.label === 'Student' || c.label === 'Exceptions' || c.label === 'Note' ? 2 : 1)
  })
  for (const g of groups) {
    const list = d.rows.filter((r) => r.class_id === g.classId).sort((p, q) => p.child.localeCompare(q.child) || p.day.localeCompare(q.day))
    const students = new Set(list.map((r) => r.child_id)).size
    const first = list[0] ? cells(list[0]) : []
    // A class heading never sits alone at the foot of a page.
    need(8 + 6.5 + Math.max(1, ...first.map((l) => l.length)) * lineH + 2.6)
    classHead(g.name, students, false)
    list.forEach((r, i) => {
      const lines = cells(r)
      const h = Math.max(...lines.map((l) => l.length)) * lineH + 2.6
      if (y + h > bottom) { newPage(); classHead(g.name, students, true) }
      if (i % 2 === 1) { doc.setFillColor('#fafbfd'); doc.rect(M, y, fullW, h, 'F') }
      let x = M
      cols.forEach((c, j) => {
        const w = c.w * scale
        font(doc, c.label === 'Student' ? 'semibold' : 'normal', 7.2, c.tone?.(r) ?? INK)
        doc.text(lines[j]!, c.align ? x + w - pad : x + pad, y + 1.3, { baseline: 'top', align: c.align ?? 'left', lineHeightFactor: 1.3 })
        x += w
      })
      doc.setDrawColor(LINE); doc.setLineWidth(0.15); doc.line(M, y + h, M + fullW, y + h)
      y += h
    })
    y += 6
  }
  if (!d.rows.length) {
    need(20)
    doc.setFillColor(TILE); doc.roundedRect(M, y, fullW, 16, 2, 2, 'F')
    font(doc, 'semibold', 8.5, INK2)
    doc.text('No attendance records match this report: no student was expected and nothing was recorded in this period.', M + fullW / 2, y + 8, { align: 'center', baseline: 'middle' })
  }
  // Footers last, when the number of pages is known.
  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p++) { doc.setPage(p); footer(doc, d, p, pages) }
  return doc.output('arraybuffer')
}
