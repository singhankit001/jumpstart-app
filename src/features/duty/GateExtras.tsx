import { useState } from 'react'
import { DoorOpen, UserCheck, UsersRound } from '../../ui/icons'
import { Avatar } from '../../ui/Avatar'
import { Button, LuxButton } from '../../ui/Button'
import { Sheet } from '../../ui/Sheet'
import { Notice } from '../../ui/States'
import { useToast } from '../../ui/Toast'
import { childColor } from '../../ui/childColor'
import { formatTime } from '../../domain/time'
import type { Direction } from '../../domain/programme'
import { explainDbError } from '../admin/api'
import { gateWalkIn } from '../school/api'
import { ProgrammeChips } from '../admin/ProgrammeChips'
import { groupByProgramme } from '../admin/programmeGroups'
import { StatePill } from '../school/Board'
import type { SchoolChild } from '../school/useSchoolDay'

const WORD: Record<Direction, string> = { dropoff: 'drop-off', pickup: 'pickup' }

/**
 * Someone arrived without "I'm on my way" (Screen Book v3): check the child in, or hand them to one of their registered
 * parents or family (D4). Anyone else needs a link and a code from a parent.
 */
function WalkInSheet({ c, direction, onClose, onDone }: { c: SchoolChild; direction: Direction; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function go(handedTo: string | null, name?: string) {
    setBusy(true)
    setError(null)
    try {
      await gateWalkIn(c.id, direction, handedTo)
      toast(direction === 'dropoff' ? `${c.first} checked in.` : `${c.first} handed over to ${name}. Recorded.`)
      onDone()
      onClose()
    } catch (e) {
      setError(explainDbError(e as { code?: string; message?: string }))
    } finally {
      setBusy(false)
    }
  }
  if (direction === 'dropoff') {
    return (
      <Sheet open onClose={onClose} title={`Check in ${c.first}?`} description={`${c.fullName} is at the gate. Parents are told at once.`}>
        {error && <Notice tone="danger" className="mb-4">{error}</Notice>}
        <div className="grid gap-2.5 sm:grid-cols-2">
          <Button variant="secondary" onClick={onClose}>Not yet</Button>
          <LuxButton tone="success" icon={<DoorOpen />} loading={busy} onClick={() => void go(null)}>Check in {c.first}</LuxButton>
        </div>
      </Sheet>
    )
  }
  return (
    <Sheet open onClose={onClose} title={`Hand over ${c.first}`} description="Only family the school has added. Anyone else needs a parent's link.">
      <div className="grid gap-2.5">
        {(['parent', 'family'] as const).map((kind) => {
          const list = c.guardians.filter((g) => g.kind === kind)
          return list.length > 0 && (
            <div key={kind} className="grid gap-2.5">
              <p className="kicker mt-1">{kind === 'parent' ? 'Parents' : 'Family'}</p>
              {list.map((g) => (
                <button key={g.id} type="button" className="choice flex items-center gap-3 p-3 text-left" disabled={busy} onClick={() => void go(g.id, g.full_name.split(' ')[0])}>
                  <Avatar name={g.full_name} color={kind === 'parent' ? 'var(--rb-blue)' : 'var(--ink-3)'} size="sm" />
                  <span className="min-w-0 flex-1"><span className="block truncate text-h4">{g.full_name}</span><span className="block text-small font-semibold text-ink-2">{g.relation}{g.abroad ? ', lives outside India' : ''}</span></span>
                  <UserCheck className="size-5 text-accent" aria-hidden />
                </button>
              ))}
            </div>
          )
        })}
        {error && <Notice tone="danger">{error}</Notice>}
        <Notice tone="warning">Someone not on this list? Don't hand over. Call a parent first.</Notice>
      </div>
    </Sheet>
  )
}

/**
 * The students in scope (your classes, or the whole school), by class: one chip per class with its count, then each
 * class's students with where their day stands, and Check in or Hand over for someone who arrives without the app.
 * The queue above holds the real requests; this is the roster, never a list of arrivals.
 */
export function ClassRoster({ children, canClose, onDone }: { children: SchoolChild[]; canClose: boolean; onDone: () => void }) {
  const [walkIn, setWalkIn] = useState<{ c: SchoolChild; direction: Direction } | null>(null)
  const [pick, setPick] = useState<string | null>(null)
  const [order, setOrder] = useState<'asc' | 'desc'>('asc')
  // Classes are the children's own (the label of their main programme), so nothing is listed that nobody is in.
  const classes = [...new Set(children.map((c) => c.className).filter(Boolean))].map((n) => ({ id: n, name: n }))
  const groups = groupByProgramme(children, classes, (c) => c.className || null, (c) => c.fullName, order)
  // A class missing from this scope (switched to Your classes, say) shows every class instead.
  const value = pick !== null && groups.some((g) => g.id === pick) ? pick : null
  const shown = value === null ? groups : groups.filter((g) => g.id === value)
  if (!children.length) return <p className="rounded-lg bg-sunken px-4 py-3 text-small font-semibold text-ink-2">No students in these classes yet.</p>
  return (
    <section className="grid gap-2.5" aria-label="Students by class">
      <h2 className="kicker flex items-center gap-2 px-0.5 [&_svg]:size-4"><UsersRound />Students · {children.length}</h2>
      <ProgrammeChips groups={groups} value={value} onChange={setPick} order={order} onOrder={setOrder} label="Class" allLabel="All classes" />
      {shown.map((g) => (
        <div key={g.id || 'none'} className="grid gap-2.5">
          <h3 className={`px-0.5 pt-1 text-h4 ${g.id ? '' : 'text-warning'}`}>{g.name} <span className="text-small font-bold text-ink-2 tabular-nums">· {g.items.length}</span></h3>
          <ul className="grid gap-2.5">
            {g.items.map((c) => {
              // Only a child with no request open: a request is handled in the queue above.
              const direction: Direction | null = c.day.trip ? null : c.day.state === 'expected' ? 'dropoff' : c.day.state === 'here' ? 'pickup' : null
              const at = c.day.next.at
              return (
                <li key={c.id} className="card flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl p-3 pr-3.5">
                  <Avatar name={c.first} color={childColor(c.id)} />
                  <span className="min-w-0 flex-1 basis-[180px]">
                    <span className="block truncate text-h4">{c.fullName}</span>
                    <span className="block truncate text-small font-semibold text-ink-2">
                      {c.className || 'Class not assigned'}{direction ? ` · ${c.day.changed[direction] ? 'changed today, ' : ''}${WORD[direction]} ${at !== null ? formatTime(at) : 'time not set'}` : ''}
                    </span>
                  </span>
                  <StatePill c={c} />
                  {canClose && direction && (
                    <LuxButton size="sm" icon={direction === 'dropoff' ? <DoorOpen /> : <UserCheck />} onClick={() => setWalkIn({ c, direction })}>
                      {direction === 'dropoff' ? 'Check in' : 'Hand over'}
                    </LuxButton>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      ))}
      {walkIn && <WalkInSheet c={walkIn.c} direction={walkIn.direction} onClose={() => setWalkIn(null)} onDone={onDone} />}
    </section>
  )
}
