import { useState } from 'react'
import { ChevronDown } from '../../ui/icons'
import { Pill, type Tone } from '../../ui/Pill'
import { SearchField } from '../../ui/Field'
import { EmptyState } from '../../ui/States'
import { formatTime, indiaClock } from '../../domain/time'
import type { Student } from './api'
import { ATTENDANCE_LABEL, type Attendance, type Row } from './engine'

const TONE: Record<Attendance, Tone> = { present: 'live', late: 'warning', absent: 'neutral', not_recorded: 'danger', expected: 'accent', not_due: 'neutral' }
const at = (iso: string | null) => (iso ? formatTime(indiaClock(new Date(iso)).minutes) : null)

export interface Group { id: string; name: string; kids: Student[] }

/**
 * Every student, in groups (a class, or a programme): one section per group, closed until tapped, or opened by a
 * search. One day shows each child's check-in, check-out and status; a longer period shows how many days each was
 * present, late, absent or without a record. Times are only the gate's recorded ones; a child who came in and hasn't
 * been collected reads "Not checked out".
 */
export function StudentGroups({ groups, rows, oneDay, noun }: { groups: Group[]; rows: Row[]; oneDay: boolean; noun: 'class' | 'programme' }) {
  const [q, setQ] = useState('')
  const needle = q.trim().toLocaleLowerCase('en-IN')
  const byChild = new Map<string, Row[]>()
  for (const r of rows) byChild.set(r.child_id, [...(byChild.get(r.child_id) ?? []), r])
  const all = groups.filter((g) => g.kids.length > 0)
  if (!all.length) return <EmptyState title="No students yet">Students appear here, by {noun}, once the admin adds them.</EmptyState>
  const shown = all
    .map((g) => ({ ...g, kids: needle && !g.name.toLocaleLowerCase('en-IN').includes(needle) ? g.kids.filter((k) => k.full_name.toLocaleLowerCase('en-IN').includes(needle)) : g.kids }))
    .filter((g) => g.kids.length > 0)

  return (
    <div className="grid gap-3">
      <SearchField label="Find a student" placeholder={`Student or ${noun} name`} value={q} onChange={(e) => setQ(e.target.value)} />
      {!shown.length && <EmptyState title={`No student or ${noun} matches "${q.trim()}"`}>Try part of a first name.</EmptyState>}
      <ul className="grid gap-3" aria-label={noun === 'class' ? 'Classes' : 'Programmes'}>
        {shown.map((g) => {
          const days = g.kids.flatMap((k) => byChild.get(k.id) ?? [])
          const count = (a: Attendance[]) => days.filter((r) => a.includes(r.attendance)).length
          const out = days.filter((r) => r.dropoff_at && !r.pickup_at && (r.attendance === 'present' || r.attendance === 'late')).length
          const summary = oneDay
            ? [`${count(['present', 'late'])} present`, `${count(['absent'])} absent`, out ? `${out} not checked out` : null].filter(Boolean).join(' · ')
            : `${count(['present', 'late'])} present days · ${count(['absent'])} absent days`
          return (
            <li key={`${g.id || 'none'}-${needle ? 'open' : 'closed'}`}>
              <details className="card group rounded-xl" open={needle ? true : undefined}>
                <summary className="flex min-h-16 cursor-pointer list-none items-center gap-3 rounded-xl px-4 py-3 sm:px-5 [&::-webkit-details-marker]:hidden">
                  <span className="min-w-0 flex-1">
                    <span className={`block text-h4 ${g.id ? '' : 'text-warning'}`}>{g.name}</span>
                    <span className="block text-small font-semibold text-ink-2">{g.kids.length} {g.kids.length === 1 ? 'student' : 'students'} · {summary}</span>
                  </span>
                  <ChevronDown className="size-5 shrink-0 text-ink-3 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
                </summary>
                <div className="overflow-x-auto border-t border-line px-2 pb-2 sm:px-3">
                  <table className="w-full min-w-[520px] table-fixed text-left text-small">
                    <caption className="sr-only">Students in {g.name}</caption>
                    <colgroup><col className="w-[40%]" /><col /><col /><col /><col /></colgroup>
                    <thead className="text-caption font-bold text-ink-2">
                      {oneDay ? (
                        <tr><th scope="col" className="px-2 py-2.5">Student</th><th scope="col" className="px-2 py-2.5">Check-in</th><th scope="col" className="px-2 py-2.5">Check-out</th><th scope="col" colSpan={2} className="px-2 py-2.5">Status</th></tr>
                      ) : (
                        <tr><th scope="col" className="px-2 py-2.5">Student</th><th scope="col" className="px-2 py-2.5 text-right">Present</th><th scope="col" className="px-2 py-2.5 text-right">Late</th><th scope="col" className="px-2 py-2.5 text-right">Absent</th><th scope="col" className="px-2 py-2.5 text-right">Not recorded</th></tr>
                      )}
                    </thead>
                    <tbody className="divide-y divide-line">
                      {g.kids.map((k) => {
                        const mine = byChild.get(k.id) ?? []
                        if (oneDay) {
                          const r = mine[0]
                          const came = r && (r.attendance === 'present' || r.attendance === 'late')
                          return (
                            <tr key={k.id}>
                              <th scope="row" className="break-words px-2 py-2.5 font-bold">{k.full_name}</th>
                              <td className="px-2 py-2.5 tabular-nums">{(r && at(r.dropoff_at)) ?? '—'}</td>
                              <td className="px-2 py-2.5 tabular-nums">{(r && at(r.pickup_at)) ?? (came && r.dropoff_at ? <span className="font-bold text-warning">Not checked out</span> : '—')}</td>
                              <td colSpan={2} className="px-2 py-2.5">{r ? <Pill tone={TONE[r.attendance]}>{ATTENDANCE_LABEL[r.attendance]}</Pill> : <Pill>{ATTENDANCE_LABEL.not_due}</Pill>}</td>
                            </tr>
                          )
                        }
                        const n = (a: Attendance[]) => mine.filter((r) => a.includes(r.attendance)).length
                        return (
                          <tr key={k.id}>
                            <th scope="row" className="break-words px-2 py-2.5 font-bold">{k.full_name}</th>
                            <td className="px-2 py-2.5 text-right tabular-nums">{n(['present', 'late'])}</td>
                            <td className="px-2 py-2.5 text-right tabular-nums">{n(['late'])}</td>
                            <td className="px-2 py-2.5 text-right tabular-nums">{n(['absent'])}</td>
                            <td className="px-2 py-2.5 text-right tabular-nums">{n(['not_recorded'])}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </details>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
