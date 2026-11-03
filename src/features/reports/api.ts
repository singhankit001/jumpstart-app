import { supabase } from '../../lib/supabase'
import type { ReportData } from './engine'
import { classLabel } from '../../domain/programme'

/** Said when a file maker or font of the build this page opened with is gone (a deploy since). */
export const NEW_VERSION = 'A new version of Jumpstart Go was installed since this page opened. Reload the page, then download again.'

export interface Filters { from: string; to: string; classId: string | null; programmeId: string | null; childId: string | null }

/** The register for these filters, from attendance_report (0062, 0064): school staff only, checked by the server. */
export async function loadReport(f: Filters): Promise<ReportData> {
  const { data, error } = await supabase.rpc('attendance_report', { p_from: f.from, p_to: f.to, p_class: f.classId, p_programme: f.programmeId, p_child: f.childId })
  if (error) throw new Error(error.message.replace(/^[a-z_]+: /, ''))
  const report = data as ReportData
  // Class and programme are one thing: the child's main programme in the school's words, grouped by that programme.
  return { ...report, rows: report.rows.map((r) => ({ ...r, class: classLabel(r.programme), class_id: r.programme, programme: classLabel(r.programme) })) }
}

export interface Option { id: string; name: string }
export interface Student { id: string; full_name: string; class_id: string; programme_id: string }
/** The classes, programmes and every current student (staff read children under 0001's policy). */
export async function loadOptions(): Promise<{ classes: Option[]; programmes: Option[]; students: Student[] }> {
  const [c, p, s] = await Promise.all([
    supabase.from('classes').select('id, name').order('sort'),
    supabase.from('programmes').select('id, name').eq('active', true).order('name'),
    supabase.from('children').select('id, full_name, class_id, programme_id').eq('active', true).order('full_name'),
  ])
  if (c.error || p.error || s.error) throw new Error("Couldn't load the classes, programmes and students.")
  return { classes: (c.data ?? []) as Option[], programmes: (p.data ?? []) as Option[], students: (s.data ?? []) as Student[] }
}

export interface Changes { status?: 'present' | 'absent' | 'on_leave' | 'off'; dropoff_at?: string | null; pickup_at?: string | null; note?: string | null }
/** An admin's correction: all or nothing, with a reason. `request` makes a retry harmless. */
export async function correctAttendance(childId: string, day: string, changes: Changes, reason: string, request: string): Promise<void> {
  const { error } = await supabase.rpc('correct_attendance', { p_child: childId, p_day: day, p_changes: changes, p_reason: reason, p_request: request })
  if (error) throw new Error(error.message.replace(/^[a-z_]+: /, ''))
}

export type ReportKind = 'executive' | 'register' | 'detailed'
export type Format = 'pdf' | 'xlsx' | 'docx' | 'csv'
/** Logged before any file is made; the server gives the Report ID and the moment of the data cutoff. */
export async function logExport(report: ReportKind, format: Format, f: Filters): Promise<{ report_id: string; generated_at: string }> {
  const { data, error } = await supabase.rpc('log_report_export', { p_report: report, p_format: format, p_filters: f })
  if (error) throw new Error(error.message.replace(/^[a-z_]+: /, ''))
  return data as { report_id: string; generated_at: string }
}
