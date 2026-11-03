import { byClassOrder, classLabel } from '../../domain/programme'

/** The section for children whose saved class (main programme) isn't on the list of active ones. */
export const NOT_ASSIGNED = 'Class not assigned'

export interface ProgrammeGroup<T> { id: string; name: string; items: T[] }

/** The school's order: by level (Playgroup to Senior KG, then the standalone classes), then morning to 360 plus. */
export const byProgrammeOrder = byClassOrder

/**
 * Students grouped by their class: their saved main programme (children.programme_id), named in the school's words
 * ("Nursery Afternoon"). Each child is in exactly one group, so the counts add up to the whole school. A programme
 * missing from `programmes` (deactivated, say) puts the child under "Class not assigned", last, rather than under a
 * guessed one. Names sort A to Z, or Z to A.
 */
export function groupByProgramme<T>(
  items: readonly T[], programmes: ReadonlyArray<{ id: string; name: string }>,
  programmeOf: (t: T) => string | null, nameOf: (t: T) => string, order: 'asc' | 'desc' = 'asc',
): Array<ProgrammeGroup<T>> {
  const names = new Map(programmes.map((p) => [p.id, p.name]))
  const by = new Map<string, ProgrammeGroup<T> & { stored: string }>()
  for (const t of items) {
    const id = programmeOf(t)
    const stored = id ? names.get(id) : undefined
    const key = stored ? id! : ''
    if (!by.has(key)) by.set(key, { id: key, name: stored ? classLabel(stored) : NOT_ASSIGNED, stored: stored ?? '', items: [] })
    by.get(key)!.items.push(t)
  }
  const sign = order === 'asc' ? 1 : -1
  for (const g of by.values()) g.items.sort((a, b) => sign * nameOf(a).localeCompare(nameOf(b), 'en-IN'))
  return [...by.values()]
    .sort((a, b) => Number(a.id === '') - Number(b.id === '') || byClassOrder(a.stored, b.stored))
    .map(({ stored: _, ...g }) => g)
}
