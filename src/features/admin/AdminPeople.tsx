import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router'
import { Baby, ChevronRight, CircleCheck, FileSpreadsheet, Globe, GraduationCap, Lock, PencilLine, Plus, ShieldCheck, ShieldOff, UserPlus } from '../../ui/icons'
import { Avatar } from '../../ui/Avatar'
import { Button, LuxButton } from '../../ui/Button'
import { SearchField } from '../../ui/Field'
import { Pill } from '../../ui/Pill'
import { Sheet } from '../../ui/Sheet'
import { EmptyState, ErrorState, Notice, SkeletonList } from '../../ui/States'
import { Tabs } from '../../ui/Tabs'
import { useToast } from '../../ui/Toast'
import { childColor } from '../../ui/childColor'
import { formatMobile } from '../../domain/contact'
import { AreaShell } from '../auth/AreaShell'
import { useSession } from '../auth/session'
import { explainDbError, loadDirectory, programmesOf, setPersonActive, type Directory, type Profile } from './api'
import { AccessState, accessStatus, ChildPage } from './ChildPage'
import { AddChildSheet } from './ChildForms'
import { EditStaffSheet, StaffSheet } from './StaffSheet'
import { AddClassSheet, ClassSheet } from './ClassSheets'
import { InviteSheet } from './InviteSheet'
import { BulkImportSheet } from './BulkImportSheet'
import { useAfterImport } from './importJob'
import { levelOf } from './programmeCatalogue'
import { levelIcon } from './ProgrammePicker'
import { ROLE } from './roles'
import { groupByProgramme } from './programmeGroups'
import { ProgrammeChips } from './ProgrammeChips'

type Tab = 'children' | 'staff' | 'classes'

/**
 * Admin → People (Screen Book v3): children first, each card showing the child's parents and family (their mobile and
 * whether they use the app), and a page of its own where they are added and managed; staff by role, with the two admins
 * protected; and the classes (the levels).
 */
export function AdminPeople() {
  const { childId } = useParams()
  const navigate = useNavigate()
  const { state } = useSession()
  const toast = useToast()
  const [dir, setDir] = useState<Directory | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('children')
  const [editingStaff, setEditingStaff] = useState<Profile | null>(null)
  const [query, setQuery] = useState('')
  // null: All students; '' : Programme not assigned; else a programme id.
  const [programme, setProgramme] = useState<string | null>(null)
  const [order, setOrder] = useState<'asc' | 'desc'>('asc')
  const [adding, setAdding] = useState<null | 'child' | 'staff' | 'class'>(null)
  const [openClass, setOpenClass] = useState<string | null>(null)
  const [inviting, setInviting] = useState<Profile | null>(null)
  const [bulk, setBulk] = useState(false)
  const [confirm, setConfirm] = useState<Profile | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const myId = state.status === 'signed-in' ? state.me?.profile_id : undefined

  const reload = useCallback(async () => {
    setLoadError(null)
    try {
      setDir(await loadDirectory())
    } catch (e) {
      setLoadError(explainDbError(e as { code?: string }))
    }
  }, [])
  useEffect(() => { void reload() }, [reload])
  useAfterImport(() => void reload().then(() => setTab('children')))

  const child = childId && dir ? dir.children.find((c) => c.id === childId && c.active) : null
  // A failed reload (a child just added, say) is said as such, never as "not on the list", which reads as a failed save.
  if (childId && dir && !child && loadError) return <AreaShell area="admin" title="People"><ErrorState title="Couldn't load people" onRetry={() => void reload()}>{loadError}</ErrorState></AreaShell>
  if (childId && dir && !child) return <AreaShell area="admin" title="People"><EmptyState title="This child isn't on the list" action={<Button onClick={() => navigate('/admin')}>Back to children</Button>}>They may have left the school, or the link is old.</EmptyState></AreaShell>
  if (child && dir) {
    return (
      <AreaShell area="admin" title="People">
        {loadError && (
          <Notice tone="danger" className="mt-4">
            Saved, but the latest details couldn't be loaded, so this page may be out of date.{' '}
            <button type="button" className="inline-flex min-h-11 items-center font-extrabold underline underline-offset-2" onClick={() => void reload()}>Reload</button>
          </Notice>
        )}
        <ChildPage key={child.id} dir={dir} child={child} onBack={() => navigate('/admin')} onChanged={reload} />
      </AreaShell>
    )
  }

  const q = query.trim().toLowerCase()
  const hit = (...xs: Array<string | null | undefined>) => !q || xs.some((x) => x?.toLowerCase().includes(q))
  const kids = dir ? dir.children.filter((c) => c.active) : []
  // Staff, and anyone left with no role and no child (removed from the gate team, say): listed here as "No role" so they
  // never vanish from every list while their record and sign-in still exist.
  const staffRows = dir ? dir.profiles.filter((p) => (dir.roles.get(p.id)?.length ?? 0) > 0 || (p.active && !dir.guardianships.some((g) => g.guardian_id === p.id))) : []
  // A child's parents first, then the family who can collect.
  const peopleOf = (childId: string) => dir!.guardianships.filter((g) => g.child_id === childId)
    .map((g) => ({ g, p: dir!.profiles.find((x) => x.id === g.guardian_id) }))
    .filter((x): x is { g: typeof x.g; p: Profile } => !!x.p)
    .sort((a, b) => Number(a.g.kind !== 'parent') - Number(b.g.kind !== 'parent'))
  const lists = dir && {
    children: kids.filter((c) => hit(c.full_name, c.preferred_name, ...programmesOf(dir, c).map((p) => p.name),
      ...dir.guardianships.filter((g) => g.child_id === c.id).flatMap((g) => { const p = dir.profiles.find((x) => x.id === g.guardian_id); return [p?.full_name, p?.phone] }))),
    staff: staffRows.filter((p) => hit(p.full_name, p.phone, ...(dir.roles.get(p.id) ?? []).map((r) => ROLE[r].name))),
    classes: dir.classes.filter((c) => c.active && hit(c.name)),
  }

  async function act(fn: () => Promise<void>, done: string) {
    setBusy(true)
    setActionError(null)
    try {
      await fn()
      await reload()
      setConfirm(null)
      toast(done)
    } catch (e) {
      setActionError(explainDbError(e as { code?: string; message?: string }))
    } finally {
      setBusy(false)
    }
  }

  const none = <EmptyState title={`No one matches "${query.trim()}"`}>Try a first name, part of a phone number{tab === 'children' ? ' or a programme' : ''}.</EmptyState>
  const contact = (p: Profile) => p.phone ? formatMobile(p.phone) : 'No contact details'
  const TABS: Array<{ key: Tab; label: string; short?: string; icon: ReactNode }> = [
    { key: 'children', label: 'Children', icon: <Baby /> },
    { key: 'staff', label: 'Staff', icon: <ShieldCheck /> },
    { key: 'classes', label: 'Classes', icon: <GraduationCap /> },
  ]

  return (
    <AreaShell area="admin" title="People" subtitle="Children, families and staff."
      actions={tab === 'staff' ? <LuxButton primary icon={<UserPlus />} onClick={() => setAdding('staff')}>Add staff</LuxButton>
        : tab === 'classes' ? <LuxButton primary icon={<Plus />} onClick={() => setAdding('class')}>Add class</LuxButton>
        : <><LuxButton icon={<FileSpreadsheet />} onClick={() => setBulk(true)}>Bulk upload</LuxButton><LuxButton primary icon={<Plus />} onClick={() => setAdding('child')}>Add child</LuxButton></>}>
      <div className="mt-6 flex flex-col gap-3 lg:flex-row lg:items-center">
        <Tabs id="people" label="People" value={tab} onChange={setTab} items={TABS.map((t) => ({ ...t, count: lists ? lists[t.key].length : null }))} />
        <SearchField label="Search people" className="min-w-0 lg:flex-1" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tab === 'children' ? 'Child, parent or programme' : 'Search names or phones'} />
      </div>
      {actionError && !confirm && <Notice tone="danger" className="mt-4">{actionError}</Notice>}

      <section id="people-panel" role="tabpanel" aria-labelledby={`people-${tab}`} className="mt-5">
        {loadError ? <ErrorState title="Couldn't load people" onRetry={() => void reload()}>{loadError}</ErrorState>
          : !dir || !lists ? <SkeletonList />
          : tab === 'children' ? (
            lists.children.length === 0 ? (q ? none : <EmptyState title="No children yet" action={<LuxButton primary icon={<Plus />} onClick={() => setAdding('child')}>Add child</LuxButton>}>Add each child with their parents and family in one step.</EmptyState>) : (() => {
              const groups = groupByProgramme(lists.children, dir.programmes, (c) => c.programme_id, (c) => c.full_name, order)
              const shown = programme === null ? groups : groups.filter((g) => g.id === programme)
              return (
                <>
                  <ProgrammeChips groups={groups} value={programme} onChange={setProgramme} order={order} onOrder={setOrder} />
                  {shown.length === 0 ? (
                    <EmptyState title="No children in this programme" action={<Button variant="secondary" onClick={() => setProgramme(null)}>Show all students</Button>}>
                      {q ? `No child in this programme matches "${query.trim()}".` : 'Nobody is in this programme now.'}
                    </EmptyState>
                  ) : shown.map((g) => (
                    <section key={g.id || 'none'} className="mt-5 first-of-type:mt-4" aria-labelledby={`prog-${g.id || 'none'}`}>
                      <h2 id={`prog-${g.id || 'none'}`} className={`mb-3 flex items-baseline gap-2 text-h4 ${g.id ? '' : 'text-warning'}`}>
                        {g.name}<span className="text-small font-semibold text-ink-2 tabular-nums">{g.items.length} {g.items.length === 1 ? 'student' : 'students'}</span>
                      </h2>
                      {!g.id && <p className="-mt-2 mb-3 text-small font-semibold text-ink-2">These children's saved programme isn't active. Open a child to choose their programme.</p>}
              <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {g.items.map((c) => {
                  const programmes = programmesOf(dir, c).map((p) => p.name).join(' + ')
                  const people = peopleOf(c.id)
                  return (
                    <li key={c.id}>
                      <button type="button" onClick={() => navigate(`/admin/child/${c.id}`)} className="card lift flex h-full w-full flex-col rounded-xl p-3.5 text-left">
                        <span className="flex w-full items-center gap-3.5">
                          <Avatar name={c.preferred_name ?? c.full_name} color={childColor(c.id)} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-h3">{c.full_name}</span>
                            <span className="line-clamp-2 text-small font-semibold text-ink-2">{programmes || 'Programme not assigned'}</span>
                          </span>
                          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-sunken [&_svg]:size-5" aria-hidden><ChevronRight /></span>
                        </span>
                        <span className="mt-3 block w-full border-t border-line pt-3">
                          {people.length ? (
                            <span className="grid gap-2.5">
                              {people.map(({ g, p }) => {
                                const access = accessStatus(p)
                                return (
                                  <span key={p.id} className="flex items-center gap-2.5">
                                    <Avatar name={p.full_name} color={g.kind === 'parent' ? 'var(--rb-blue)' : 'var(--ink-3)'} size="xs" />
                                    <span className="min-w-0 flex-1">
                                      <span className="block truncate text-small font-bold">{p.full_name}<span className="font-semibold text-ink-2">, {g.relation.split(',')[0]}</span></span>
                                      <span className="flex min-w-0 items-center gap-1.5 text-caption font-semibold text-ink-2">
                                        <span className="truncate tabular-nums">{p.phone ? formatMobile(p.phone) : 'No mobile yet'}</span>
                                        {p.abroad && <Globe className="size-3.5 shrink-0" aria-label="Lives outside India" />}
                                      </span>
                                    </span>
                                    <span className={`inline-flex shrink-0 items-center gap-1.5 text-caption font-bold ${access.cls}`}><span className="size-2 rounded-full bg-current" aria-hidden />{access.short}</span>
                                  </span>
                                )
                              })}
                            </span>
                          ) : <span className="block text-small font-bold text-warning">No parent or family added yet</span>}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
                    </section>
                  ))}
                </>
              )
            })()
          ) : tab === 'staff' ? (
            <>
              <div className="card mb-4 flex items-start gap-3 rounded-xl p-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-sm bg-accent-soft text-accent [&_svg]:size-5" aria-hidden><ShieldCheck /></span>
                <div><p className="text-h4">Admin: Ankit Singh and Aditya Tapadia only</p><p className="text-small font-semibold text-ink-2">Nobody else can be given Admin, and admins can't be switched off here.</p></div>
              </div>
              {lists.staff.length === 0 ? (q ? none : <EmptyState title="No staff yet">Add the head office, the front desk and the gate team.</EmptyState>) : (
                <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {lists.staff.map((p) => {
                    const roles = dir.roles.get(p.id) ?? []
                    const admin = roles.includes('admin')
                    return (
                      <li key={p.id} className={`card lift flex h-full flex-col rounded-2xl p-4 ${p.active ? '' : 'opacity-75'}`}>
                        <div className="flex items-start gap-3">
                          <Avatar name={p.full_name} color={childColor(p.id)} />
                          <div className="min-w-0 flex-1 pt-0.5">
                            <p className="truncate text-h4">{p.full_name}{p.id === myId && <span className="font-semibold text-ink-3"> (you)</span>}</p>
                            <p className="truncate text-small font-semibold text-ink-2">{contact(p)}</p>
                          </div>
                          <button type="button" className="iconbtn" aria-label={`Edit ${p.full_name}`} onClick={() => setEditingStaff(p)}><PencilLine /></button>
                        </div>
                        <div className="mb-4 mt-3 flex flex-wrap gap-1.5">
                          {roles.length ? roles.map((r) => <Pill key={r} icon={ROLE[r].icon}>{ROLE[r].name}</Pill>)
                            : <Pill tone="stale" icon={<ShieldOff />}>No role: use Add staff with their mobile to give one</Pill>}
                        </div>
                        <div className="mt-auto flex min-h-[57px] flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-line pt-3">
                          {p.active ? <AccessState person={p} onInvite={p.id === myId ? undefined : setInviting} onChanged={() => void reload()} /> : <Pill tone="stale" icon={<ShieldOff />}>Access off</Pill>}
                          {p.id === myId ? null : admin ? <span className="inline-flex items-center gap-1.5 text-small font-bold text-ink-3"><Lock className="size-4" aria-hidden />Protected</span>
                            : p.active ? <Button size="md" variant="secondary" onClick={() => { setActionError(null); setConfirm(p) }}>Turn off</Button>
                            : <Button size="md" icon={<CircleCheck />} loading={busy} onClick={() => void act(() => setPersonActive(p.id, true), `${p.full_name.split(' ')[0]} can sign in again.`)}>Turn on</Button>}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </>
          ) : (
            <>
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {lists.classes.map((c) => {
                  const n = kids.filter((k) => k.class_id === c.id).length
                  const who = dir.coordinatorClasses.filter((a) => a.class_id === c.id).map((a) => dir.profiles.find((p) => p.id === a.profile_id)).filter((p) => p?.active)
                  const level = dir.programmes.find((p) => p.class_id === c.id)
                  const progs = dir.programmes.filter((p) => p.class_id === c.id).length
                  return (
                    <li key={c.id}>
                      <button type="button" className="card lift flex w-full items-center gap-3.5 rounded-xl p-3.5 text-left" onClick={() => setOpenClass(c.id)}>
                      <span className="grid size-12 shrink-0 place-items-center rounded-md bg-accent-soft text-accent [&_svg]:size-6" aria-hidden>{level ? levelIcon(levelOf(level).level) : <GraduationCap />}</span>
                      <span className="min-w-0">
                        <span className="block text-h4">{c.name}</span>
                        <span className={`block text-small font-semibold ${who.length ? 'text-ink-2' : 'text-warning'}`}>{n} {n === 1 ? 'child' : 'children'}, {who.length ? who.map((p) => p!.full_name.split(' ')[0]).join(' and ') : 'nobody on the gate'}</span>
                        <span className="block text-small font-semibold text-ink-3">{progs === 0 ? 'No programmes yet' : `${progs} ${progs === 1 ? 'programme' : 'programmes'}`}</span>
                      </span>
                      <ChevronRight className="ml-auto size-5 shrink-0 text-ink-3" aria-hidden />
                      </button>
                    </li>
                  )
                })}
              </ul>
              <p className="mt-3 text-caption font-semibold text-ink-3">Open a class to set its drop-off and pickup times.</p>
            </>
          )}
      </section>

      {dir && adding === 'child' && <AddChildSheet open dir={dir} onClose={() => setAdding(null)} onSaved={(id, name) => reload().then(() => { setAdding(null); toast(`${name} added.`); navigate(`/admin/child/${id}`) })} />}
      {dir && bulk && <BulkImportSheet programmes={dir.programmes} onClose={() => setBulk(false)} />}
      {inviting && <InviteSheet person={inviting} onClose={() => setInviting(null)} onDone={() => void reload()} />}
      {adding === 'class' && <AddClassSheet onClose={() => setAdding(null)} onAdded={(id) => void reload().then(() => { setAdding(null); setOpenClass(id); toast('Class added. Now add its programmes.') })} />}
      {dir && openClass && dir.classes.some((c) => c.id === openClass) && (
        <ClassSheet cls={dir.classes.find((c) => c.id === openClass)!} dir={dir} onClose={() => setOpenClass(null)} onChanged={reload} />
      )}
      {dir && editingStaff && <EditStaffSheet dir={dir} person={editingStaff} onClose={() => setEditingStaff(null)} onSaved={(m) => void reload().then(() => { setEditingStaff(null); toast(m) })} />}
      {dir && adding === 'staff' && <StaffSheet open dir={dir} onClose={() => setAdding(null)} onSaved={(m) => void reload().then(() => { setAdding(null); setTab('staff'); toast(m) })} />}
      <Sheet open={!!confirm} onClose={() => setConfirm(null)}
        title={confirm ? `Turn off ${confirm.full_name.split(' ')[0]}'s access?` : ''}
        description={confirm ? `${confirm.full_name.split(' ')[0]} is signed out everywhere at once and stops hearing announcements. You can turn it back on later.` : ''}>
        {actionError && <Notice tone="danger" className="mb-4">{actionError}</Notice>}
        <div className="grid gap-2.5 sm:grid-cols-2">
          <Button variant="secondary" onClick={() => setConfirm(null)}>Keep access</Button>
          <Button variant="danger" icon={<Lock />} loading={busy} onClick={() => confirm && void act(() => setPersonActive(confirm.id, false), `${confirm.full_name.split(' ')[0]} is signed out everywhere.`)}>Turn off access</Button>
        </div>
      </Sheet>
    </AreaShell>
  )
}
