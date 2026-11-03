import { ArrowDown, ArrowUp } from '../../ui/icons'
import type { ProgrammeGroup } from './programmeGroups'

/**
 * All students, then one chip per programme that has students, each with its count, then the sort order. Scrolls
 * sideways on a phone instead of wrapping into a wall of chips. `value` null is All students; '' is "not assigned".
 */
export function ProgrammeChips<T>({ groups, value, onChange, order, onOrder, label = 'Programme' }: {
  groups: ReadonlyArray<ProgrammeGroup<T>>
  value: string | null
  onChange: (id: string | null) => void
  order: 'asc' | 'desc'
  onOrder: (o: 'asc' | 'desc') => void
  label?: string
}) {
  const total = groups.reduce((n, g) => n + g.items.length, 0)
  const chip = (id: string | null, name: string, n: number) => (
    <button key={id ?? 'all'} type="button" className="choice inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap px-4 py-2 text-small font-bold"
      aria-pressed={value === id} onClick={() => onChange(id)}>
      {name}<span className="rounded-full bg-sunken px-2 py-0.5 text-caption font-extrabold tabular-nums text-ink-2">{n}</span>
    </button>
  )
  return (
    <div className="-mt-2 flex min-w-0 items-center gap-2">
      <div className="-mx-1 flex min-w-0 flex-1 gap-2 overflow-x-auto px-1 pb-1.5 pt-3 [scrollbar-width:none]" role="group" aria-label={label}>
        {chip(null, 'All students', total)}
        {groups.map((g) => chip(g.id, g.name, g.items.length))}
      </div>
      <button type="button" className="iconbtn shrink-0" onClick={() => onOrder(order === 'asc' ? 'desc' : 'asc')}
        aria-label={order === 'asc' ? 'Names A to Z. Switch to Z to A' : 'Names Z to A. Switch to A to Z'} title={order === 'asc' ? 'A to Z' : 'Z to A'}>
        {order === 'asc' ? <ArrowDown /> : <ArrowUp />}
      </button>
    </div>
  )
}
