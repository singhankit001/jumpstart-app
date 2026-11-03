import { LEVELS } from './programmeCatalogue'

/** The section for children whose main programme isn't on the list of active programmes. */
export const NOT_ASSIGNED = 'Programme not assigned'

export interface ProgrammeGroup<T> { id: string; name: string; items: T[] }

const levelRank = (name: string) => {
  const i = LEVELS.findIndex((l) => name === l.key || name.startsWith(`${l.key} · `))
  return i < 0 ? LEVELS.length : i
}
/** The school's order: by level (Playgroup to Sr KG, then the standalone programmes), then by name. */
export const byProgrammeOrder = (a: string, b: string) => levelRank(a) - levelRank(b) || a.localeCompare(b, 'en-IN')

/**
 * Students grouped by their saved main programme (children.programme_id: it gives the class, so each child is in exactly
 * one group and the counts add up to the whole school). A programme missing from `programmes` (deactivated, say) puts
 * the child under "Programme not assigned", last, rather than under a guessed one. Names sort A to Z, or Z to A.
 */
export function groupByProgramme<T>(
  items: readonly T[], programmes: ReadonlyArray<{ id: string; name: string }>,
  programmeOf: (t: T) => string | null, nameOf: (t: T) => string, order: 'asc' | 'desc' = 'asc',
): Array<ProgrammeGroup<T>> {
  const names = new Map(programmes.map((p) => [p.id, p.name]))
  const by = new Map<string, ProgrammeGroup<T>>()
  for (const t of items) {
    const id = programmeOf(t)
    const name = id ? names.get(id) : undefined
    const key = name ? id! : ''
    if (!by.has(key)) by.set(key, { id: key, name: name ?? NOT_ASSIGNED, items: [] })
    by.get(key)!.items.push(t)
  }
  const sign = order === 'asc' ? 1 : -1
  for (const g of by.values()) g.items.sort((a, b) => sign * nameOf(a).localeCompare(nameOf(b), 'en-IN'))
  return [...by.values()].sort((a, b) => Number(a.id === '') - Number(b.id === '') || byProgrammeOrder(a.name, b.name))
}
