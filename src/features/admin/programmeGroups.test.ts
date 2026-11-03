import { describe, expect, it } from 'vitest'
import { byProgrammeOrder, groupByProgramme, NOT_ASSIGNED } from './programmeGroups'

const programmes = [
  { id: 'lc', name: 'Learning Center' }, { id: 'sr', name: 'Sr KG · Half day' }, { id: 'pg', name: 'Playgroup · 360°' }, { id: 'nu', name: 'Nursery · 360°+' },
]
const kids = [
  { id: '1', name: 'Vihaan Kulkarni', p: 'sr' }, { id: '2', name: 'aarav Joshi', p: 'sr' }, { id: '3', name: 'Diya Patil', p: 'lc' },
  { id: '4', name: 'Myra Iyer', p: 'gone' }, { id: '5', name: 'Kabir Rao', p: 'pg' }, { id: '6', name: 'Ira Mehta', p: null },
]
const group = (order?: 'asc' | 'desc') => groupByProgramme(kids, programmes, (k) => k.p, (k) => k.name, order)

describe('groupByProgramme', () => {
  it('puts each child under their saved programme, in the school order, with "not assigned" last', () => {
    const g = group()
    expect(g.map((x) => x.name)).toEqual(['Playgroup · 360°', 'Sr KG · Half day', 'Learning Center', NOT_ASSIGNED])
    expect(g.map((x) => x.items.length)).toEqual([1, 2, 1, 2])
    // Every child exactly once: the counts add up to everyone.
    expect(g.flatMap((x) => x.items.map((k) => k.id)).sort()).toEqual(['1', '2', '3', '4', '5', '6'])
  })
  it('never guesses a programme: an unknown or missing one is "not assigned"', () => {
    const none = group().find((x) => x.id === '')!
    expect(none.items.map((k) => k.name)).toEqual(['Ira Mehta', 'Myra Iyer'])
  })
  it('sorts names A to Z within each programme, ignoring case, or Z to A', () => {
    expect(group().find((x) => x.id === 'sr')!.items.map((k) => k.name)).toEqual(['aarav Joshi', 'Vihaan Kulkarni'])
    expect(group('desc').find((x) => x.id === 'sr')!.items.map((k) => k.name)).toEqual(['Vihaan Kulkarni', 'aarav Joshi'])
  })
  it('hides programmes nobody is in, and handles nobody at all', () => {
    expect(group().some((x) => x.id === 'nu')).toBe(false)
    expect(groupByProgramme([], programmes, () => null, () => '')).toEqual([])
  })
  it('orders by level, then name', () => {
    expect(['After School Program', 'Sr KG · 360°', 'Nursery · Half day (morning)', 'Nursery · 360°', 'Custom class'].sort(byProgrammeOrder))
      .toEqual(['Nursery · 360°', 'Nursery · Half day (morning)', 'Sr KG · 360°', 'After School Program', 'Custom class'])
  })
})
