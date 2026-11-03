/**
 * Bulk upload of children and their families (D37): read a CSV or Excel (.xlsx) sheet, check every row, and describe
 * each one for public.import_child (0022). Pure functions, no dependencies: .xlsx is a zip of XML files, which the
 * browser's own DecompressionStream can open.
 */
import { normalizeMobile } from '../../domain/contact'
import type { ProgrammeRow } from './api'
import { classLabel } from '../../domain/programme'

// ---- Reading the file --------------------------------------------------------------------------------------------

/** Rows of cells from a CSV or .xlsx file (the first sheet). */
export async function readSheet(file: Blob & { name?: string }): Promise<string[][]> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  // A zip file (every .xlsx) starts "PK\x03\x04".
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4) return readXlsx(bytes)
  if (/\.xls$/i.test(file.name ?? '')) throw new Error('old_excel')
  // Excel on Windows saves "CSV (Comma delimited)" in the old Windows encoding, not UTF-8: read it as that, or Zoë is garbled.
  let text: string
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { text = new TextDecoder('windows-1252').decode(bytes) }
  return parseCsv(text)
}

/** RFC 4180 CSV: quoted fields with commas, quotes and line breaks; comma, semicolon or tab, whichever the header uses. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '')
  const header = src.slice(0, src.search(/\r?\n|$/))
  const counts = [',', ';', '\t'].map((d) => [d, header.split(d).length] as const)
  const sep = counts.reduce((a, b) => (b[1] > a[1] ? b : a))[0]
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++ }
      else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === sep) { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += ch
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows
}

const u16 = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8)
const u32 = (b: Uint8Array, o: number) => (u16(b, o) | (u16(b, o + 2) << 16)) >>> 0

/** The files in a zip, by name, unpacked (stored or deflated, the two methods Excel uses). */
async function unzip(b: Uint8Array): Promise<Map<string, string>> {
  let end = -1
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65_557); i--) if (u32(b, i) === 0x06054b50) { end = i; break }
  if (end < 0) throw new Error('bad_file')
  const files = new Map<string, string>()
  let p = u32(b, end + 16)
  for (let n = u16(b, end + 10); n > 0; n--) {
    if (u32(b, p) !== 0x02014b50) throw new Error('bad_file')
    const method = u16(b, p + 10)
    const size = u32(b, p + 20)
    const nameLen = u16(b, p + 28)
    const extra = u16(b, p + 30)
    const comment = u16(b, p + 32)
    const local = u32(b, p + 42)
    const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nameLen))
    p += 46 + nameLen + extra + comment
    if (!/\.(xml|rels)$/.test(name)) continue
    const start = local + 30 + u16(b, local + 26) + u16(b, local + 28)
    const raw = b.slice(start, start + size)
    const data = method === 0 ? raw
      : method === 8 ? new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer())
      : null
    if (data) files.set(name, new TextDecoder().decode(data))
  }
  return files
}

const unescapeXml = (s: string) => s.replace(/&(lt|gt|quot|apos|amp|#(\d+)|#x([0-9a-f]+));/gi, (m, n: string, d?: string, h?: string) =>
  d ? String.fromCodePoint(Number(d)) : h ? String.fromCodePoint(parseInt(h, 16)) : ({ lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' } as Record<string, string>)[n.toLowerCase()] ?? m)
/** All the text in an XML fragment's <t> elements (a cell or shared string can be split into formatted runs). */
const textOf = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unescapeXml(m[1]!)).join('')

/** The first sheet of an .xlsx workbook as rows of text (numbers as written; dates as Excel serial numbers). */
export async function readXlsx(b: Uint8Array): Promise<string[][]> {
  const files = await unzip(b)
  const workbook = files.get('xl/workbook.xml') ?? ''
  const rels = files.get('xl/_rels/workbook.xml.rels') ?? ''
  const firstId = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(workbook)?.[1]
  const target = firstId ? new RegExp(`<Relationship\\b[^>]*Id="${firstId}"[^>]*Target="([^"]+)"`).exec(rels)?.[1]
    ?? new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${firstId}"`).exec(rels)?.[1] : undefined
  const sheetPath = target ? (target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`) : 'xl/worksheets/sheet1.xml'
  const sheet = files.get(sheetPath) ?? files.get('xl/worksheets/sheet1.xml')
  if (!sheet) throw new Error('bad_file')
  const shared = [...(files.get('xl/sharedStrings.xml') ?? '').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]!))
  const rows: string[][] = []
  // An empty row can be written <row r="4"/>, and blank rows are often left out: the r="" number keeps each row in its place,
  // so "row 12" in a message is row 12 in the school's sheet.
  for (const r of sheet.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const at = Number(/\br="(\d+)"/.exec(r[1]!)?.[1] ?? rows.length + 1)
    while (rows.length < at - 1) rows.push([])
    const row: string[] = []
    for (const c of (r[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1]!
      const ref = /\br="([A-Z]+)\d+"/.exec(attrs)?.[1]
      const col = ref ? [...ref].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1 : row.length
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1]
      const body = c[2] ?? ''
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1]
      const value = type === 's' ? shared[Number(v)] ?? '' : type === 'inlineStr' ? textOf(body) : unescapeXml(v ?? '')
      while (row.length < col) row.push('')
      row[col] = value
    }
    rows.push(row)
  }
  return rows
}

// ---- Understanding the rows ----------------------------------------------------------------------------------------

type Field = 'child' | 'dob' | 'gender' | 'programme' | 'childPhone'
  | 'p1Name' | 'p1Relation' | 'p1Mobile' | 'p2Name' | 'p2Relation' | 'p2Mobile'
  | 'fName' | 'fRelation' | 'fMobile'

/**
 * The template's four columns, all needed (owner, 2026-10-06): the child's name and date of birth, a parent's name and
 * contact number. The programme, relation and the rest are chosen in the app. Older sheets with the extra columns below
 * still work: anything they fill in is used.
 */
export const COLUMNS: Array<{ field: Field; header: string; aliases?: string[]; required?: boolean }> = [
  { field: 'child', header: 'Child full name', aliases: ['childname', 'child', 'name', 'fullname', 'studentname'], required: true },
  { field: 'dob', header: 'Date of birth', aliases: ['dob', 'birthdate', 'childdateofbirth', 'dateofbirthddmmyyyy'], required: true },
  { field: 'p1Name', header: 'Parent name', aliases: ['parent1name', 'parent1fullname', 'parentfullname', 'mothername', 'fathername'], required: true },
  { field: 'p1Mobile', header: 'Contact number', aliases: ['contact', 'contactno', 'mobile', 'mobileno', 'mobilenumber', 'phone', 'phoneno', 'phonenumber', 'parentmobile', 'parentcontactnumber', 'parent1mobile', 'parent1phone', 'parent1contactnumber', 'parent1number', 'childcontactnumber'], required: true },
]
/** Columns older templates had: read when present, never asked for. */
const EXTRA: typeof COLUMNS = [
  { field: 'gender', header: 'Boy or girl', aliases: ['gender', 'sex', 'boygirl'] },
  { field: 'programme', header: 'Programme', aliases: ['program', 'classandprogramme', 'classprogramme', 'class', 'plan'] },
  { field: 'childPhone', header: 'Child contact number', aliases: ['childmobile', 'childphone'] },
  { field: 'p1Relation', header: 'Parent 1 relation', aliases: ['parent1relationship', 'parentrelation', 'relation'] },
  { field: 'p2Name', header: 'Parent 2 name', aliases: ['parent2fullname'] },
  { field: 'p2Relation', header: 'Parent 2 relation', aliases: ['parent2relationship'] },
  { field: 'p2Mobile', header: 'Parent 2 mobile', aliases: ['parent2phone', 'parent2contactnumber', 'parent2number'] },
  { field: 'fName', header: 'Family member name', aliases: ['familyname', 'othercollectorname', 'collectorname'] },
  { field: 'fRelation', header: 'Family member relation', aliases: ['familyrelation', 'familyrelationship'] },
  { field: 'fMobile', header: 'Family member mobile', aliases: ['familymobile', 'familyphone', 'familycontactnumber'] },
]
const ALL = [...COLUMNS, ...EXTRA]

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9+]/g, '')

/** Which column holds which field, from the header row. Missing required columns are named. */
export function mapHeader(header: string[]): { map: Partial<Record<Field, number>>; missing: string[] } {
  const map: Partial<Record<Field, number>> = {}
  header.forEach((h, i) => {
    const k = key(h)
    const col = ALL.find((c) => map[c.field] === undefined && (key(c.header) === k || c.aliases?.includes(k)))
    if (col) map[col.field] = i
  })
  return { map, missing: COLUMNS.filter((c) => c.required && map[c.field] === undefined).map((c) => c.header) }
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const iso = (y: number, m: number, d: number) => {
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? t.toISOString().slice(0, 10) : null
}

/** A date of birth as YYYY-MM-DD: 2022-03-04, 04/03/2022 or 4-3-2022 (day first, as in India), 4 Mar 2022, or an Excel date. */
export function parseDate(input: string): string | null {
  const s = input.trim()
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s)
  if (m) return iso(+m[1]!, +m[2]!, +m[3]!)
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s)
  if (m) return iso(+m[3]!, +m[2]!, +m[1]!)
  m = /^(\d{1,2})[\s-]+([a-z]{3})[a-z]*[\s-]+(\d{4})$/i.exec(s)
  if (m && MONTHS.includes(m[2]!.toLowerCase())) return iso(+m[3]!, MONTHS.indexOf(m[2]!.toLowerCase()) + 1, +m[1]!)
  // Excel stores dates as days since 30 Dec 1899 (a birthday between 2010 and 2050 is 40,000 to 55,000).
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const n = Math.floor(Number(s))
    if (n > 36_000 && n < 60_000) return new Date(Date.UTC(1899, 11, 30) + n * 86_400_000).toISOString().slice(0, 10)
  }
  return null
}

/** The programme a cell names: "Nursery · 360°", "nursery 360", "NURSERY-360°" all match; 360°+ stays distinct. */
export function matchProgramme(input: string, programmes: ProgrammeRow[]): ProgrammeRow | null {
  const k = key(input)
  // The school's own wording too: "Nursery Afternoon", "Junior KG 360 plus".
  return k ? programmes.find((p) => key(p.name) === k || key(classLabel(p.name)) === k) ?? null : null
}

export interface Person { full_name: string; relation: string; kind: 'parent' | 'family'; phone: string; app_access: boolean }
export interface ImportRow {
  /** The row number in the sheet (1 = the header). */
  line: number
  cells: string[]
  childName: string
  /** The programme is chosen in the app (BulkImportSheet) unless the sheet named one: null until then. */
  child: { full_name: string; preferred_name: string | null; date_of_birth: string | null; programme_id: string | null; gender: 'boy' | 'girl' | null } | null
  programmeName: string | null
  people: Person[]
  /** Stop the row: it can't be imported until they're fixed. */
  problems: string[]
  /** Details missing or unreadable: the row is imported without them, and the school fills them in later. */
  warnings: string[]
}

/**
 * Every data row, checked. The child's name and date of birth, and a parent's name and contact number are needed: a row
 * missing one isn't imported. Anything else missing or unreadable is a warning. Each is a sentence the school can act on.
 */
export function checkRows(rows: string[][], programmes: ProgrammeRow[], today = new Date()): { rows: ImportRow[]; missing: string[]; header: string[] } {
  // The column names are usually row 1, but a sheet often has a title or a note above them: the first of the top 10 rows
  // that names every needed column is the header. Otherwise the gaps of the row that comes closest are reported.
  const top = rows.slice(0, 10).map((r, i) => ({ i, ...mapHeader(r) }))
  const found = top.reduce<(typeof top)[number] | undefined>((best, h) => (!best || h.missing.length < best.missing.length ? h : best), undefined)
    ?? { i: 0, ...mapHeader([]) }
  const { map, missing } = found
  const header = rows[found.i] ?? []
  const data = rows.slice(found.i + 1)
  if (missing.length) return { rows: [], missing, header }
  const get = (r: string[], f: Field) => (map[f] === undefined ? '' : (r[map[f]!] ?? '').trim())
  const todayIso = today.toISOString().slice(0, 10)
  const seen = new Map<string, number>()
  const out: ImportRow[] = []
  data.forEach((r, i) => {
    if (r.every((c) => !c.trim())) return
    const line = found.i + i + 2
    const problems: string[] = []
    const warnings: string[] = []
    const name = get(r, 'child').replace(/\s+/g, ' ')
    if (name.length < 2) problems.push("The child's full name is missing.")
    const dobText = get(r, 'dob')
    const dob = parseDate(dobText)
    const dobOk = !!dob && dob <= todayIso && dob >= '2010-01-02'
    if (!dobText) problems.push('The date of birth is missing.')
    else if (!dob) problems.push(`"${dobText}" isn't a date. Write it as DD/MM/YYYY.`)
    else if (!dobOk) problems.push(`${dobText} can't be right for a preschool child.`)
    // Boy or girl, optional: picks the child's picture (D39).
    const genderText = get(r, 'gender').toLowerCase()
    const gender = /^(boy|b|m|male|son)$/.test(genderText) ? 'boy' as const : /^(girl|g|f|female|daughter)$/.test(genderText) ? 'girl' as const : null
    if (genderText && !gender) warnings.push(`"${get(r, 'gender')}" isn't Boy or Girl, so it's left empty.`)
    const progText = get(r, 'programme')
    const programme = matchProgramme(progText, programmes)
    if (progText && !programme) warnings.push(`"${progText}" isn't one of the school's programmes: choose it here.`)
    if (name) {
      const k = `${name.toLowerCase()}|${dobOk ? dob : ''}`
      if (seen.has(k)) problems.push(`The same child is on row ${seen.get(k)}.`)
      else seen.set(k, line)
    }

    const people: Person[] = []
    const person = (label: string, n: string, rel: string, mobile: string, kind: 'parent' | 'family', fallbackRel: string) => {
      if (!n && !mobile) return
      if (n.replace(/\s+/g, ' ').length < 2) { warnings.push(`${label} has a mobile but no name, so they're left out.`); return }
      const phone = mobile ? normalizeMobile(mobile) : null
      if (mobile && !phone) warnings.push(`${label}'s mobile "${mobile}" isn't a mobile number, so it's left out.`)
      if (!phone) { warnings.push(`${label} has no mobile, so they're left out. Add them on the child's page.`); return }
      // The mobile is how they sign in, so everyone listed gets app access.
      people.push({ full_name: n.replace(/\s+/g, ' '), relation: rel || fallbackRel, kind, phone, app_access: true })
    }
    // "Child contact number" (the family's number) stands in for Parent 1's mobile when that's empty.
    person('The parent', get(r, 'p1Name'), get(r, 'p1Relation'), get(r, 'p1Mobile') || get(r, 'childPhone'), 'parent', 'Parent')
    person('Parent 2', get(r, 'p2Name'), get(r, 'p2Relation'), get(r, 'p2Mobile'), 'parent', 'Parent')
    person('The family member', get(r, 'fName'), get(r, 'fRelation'), get(r, 'fMobile'), 'family', 'Family')
    const contact = get(r, 'p1Mobile') || get(r, 'childPhone')
    if (get(r, 'p1Name').replace(/\s+/g, ' ').length < 2) problems.push("The parent's name is missing.")
    else if (!contact) problems.push('The contact number is missing.')
    else if (!normalizeMobile(contact)) problems.push(`"${contact}" isn't a mobile number. Use 10 digits, or + and the country code.`)
    const phones = people.map((p) => p.phone)
    if (new Set(phones).size < phones.length) problems.push('Two people on this row have the same mobile.')

    out.push({
      line, cells: r, childName: name, programmeName: programme?.name ?? null, people, problems, warnings,
      child: name.length >= 2 ? { full_name: name, preferred_name: null, date_of_birth: dobOk ? dob : null, programme_id: programme?.id ?? null, gender } : null,
    })
  })
  return { rows: out, missing: [], header }
}

// ---- Writing CSV (the template, and the rows to fix) ---------------------------------------------------------------

const csvCell = (s: string) => (/[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
export const toCsv = (rows: string[][]) => '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'

/** The template: the four columns, and one example row the school replaces. */
export function templateCsv(): string {
  return toCsv([COLUMNS.map((c) => c.header), ['Aarav Kulkarni', '04/03/2022', 'Priya Kulkarni', '98765 43210']])
}
