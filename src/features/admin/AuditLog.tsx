import { useEffect, useState } from 'react'
import { ScrollText } from '../../ui/icons'
import { EmptyState, ErrorState, SkeletonList } from '../../ui/States'
import { supabase } from '../../lib/supabase'
import { indiaClock, formatTime } from '../../domain/time'
import { AreaShell } from '../auth/AreaShell'
import { explainDbError, loadDirectory } from './api'
import { describe, type AuditRow, type Names } from './auditText'
import { classLabel } from '../../domain/programme'

// ponytail: the newest 300 entries; add paging ("Older") when the log is read further back than a few busy days.
const LIMIT = 300

interface Entry { id: number; day: string; time: string; what: string; detail?: string; who: string }

/** Admin → Audit log (ADM-3): every sensitive change, newest first, in words, with who made it. Admin only (RLS). */
export function AuditLog() {
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = () => {
    setError(null)
    void Promise.all([
      supabase.from('audit_log').select('id, at, actor, action, table_name, old_row, new_row').order('at', { ascending: false }).limit(LIMIT),
      loadDirectory(),
    ]).then(([log, dir]) => {
      if (log.error) return setError(explainDbError(log.error))
      const person = (id: unknown) => dir.profiles.find((p) => p.id === id)?.full_name ?? 'Someone no longer listed'
      const names: Names = {
        person,
        child: (id) => { const c = dir.children.find((x) => x.id === id); return c ? c.preferred_name ?? c.full_name.split(' ')[0]! : 'a child' },
        className: (id) => dir.classes.find((c) => c.id === id)?.name ?? 'a class',
        programme: (id) => { const p = dir.programmes.find((x) => x.id === id); return p ? classLabel(p.name) : 'a class' },
      }
      const out: Entry[] = []
      for (const r of (log.data ?? []) as AuditRow[]) {
        const d = describe(r, names)
        if (!d) continue
        const at = new Date(r.at)
        const actor = r.actor ? dir.profiles.find((p) => p.user_id === r.actor)?.full_name : null
        out.push({ id: r.id, day: at.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' }), time: formatTime(indiaClock(at).minutes), ...d, who: actor ?? 'Jumpstart (automatic)' })
      }
      setEntries(out)
    }, (e: unknown) => setError(explainDbError(e as { code?: string })))
  }
  useEffect(load, [])

  const days = entries ? [...new Set(entries.map((e) => e.day))] : []
  return (
    <AreaShell area="admin" title="Audit log" subtitle="Every sensitive change, newest first.">
      <section className="mt-6" aria-busy={!entries}>
        {error ? <ErrorState title="Couldn't load the audit log" onRetry={load}>{error}</ErrorState>
          : !entries ? <SkeletonList count={6} className="grid gap-3" height="h-[64px]" />
          : entries.length === 0 ? <EmptyState title="Nothing recorded yet">Changes to people, children, timings, roles and pickups appear here as they happen.</EmptyState>
          : (
            <div className="grid items-start gap-6 xl:grid-cols-2">
              {days.map((day) => (
                <div key={day}>
                  <h2 className="kicker mb-2.5 flex items-center gap-2 [&_svg]:size-4"><ScrollText aria-hidden />{day}</h2>
                  <ol className="card divide-y divide-line rounded-2xl px-5">
                    {entries.filter((e) => e.day === day).map((e) => (
                      <li key={e.id} className="grid grid-cols-[64px_1fr] gap-3 py-3">
                        <time className="pt-0.5 text-small font-bold text-ink-2 tabular-nums">{e.time}</time>
                        <div className="min-w-0">
                          <p className="text-h4 text-pretty">{e.what}</p>
                          <p className="text-small font-semibold text-ink-2">{e.who}{e.detail ? `. ${e.detail}` : ''}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
              {entries.length >= LIMIT - 20 && <p className="text-caption xl:col-span-2 font-semibold text-ink-3">Showing the most recent changes.</p>}
            </div>
          )}
      </section>
    </AreaShell>
  )
}
