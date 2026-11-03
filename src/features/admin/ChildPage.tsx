import { useState, type ReactNode } from 'react'
import { ChevronLeft, Globe, Heart, KeyRound, LogOut, Lock, Pencil, PencilLine, Plus, Send, Trash2, UserPlus, UserRound } from '../../ui/icons'
import { Avatar } from '../../ui/Avatar'
import { Button } from '../../ui/Button'
import { TextField } from '../../ui/Field'
import { DateField } from '../../ui/DateField'
import { Pill } from '../../ui/Pill'
import { Sheet, SheetFooter } from '../../ui/Sheet'
import { Notice } from '../../ui/States'
import { Switch } from '../../ui/Switch'
import { useToast } from '../../ui/Toast'
import { childColor } from '../../ui/childColor'
import { formatMobile } from '../../domain/contact'
import { formatTime, toMinutes } from '../../domain/time'
import { childLeft, explainDbError, programmesOf, removeGuardian, setAppAccess, setProgrammes, updateChild, type Child, type Directory, type Profile } from './api'
import { AddGuardianSheet, EditGuardianSheet } from './ChildForms'
import { GenderChoice } from '../../ui/GenderChoice'
import { InviteSheet, invitedLine } from './InviteSheet'
import { PasswordSheet } from './PasswordSheet'
import { formatAge, levelOf } from './programmeCatalogue'
import { AlsoInSheet, levelIcon, ProgrammePicker } from './ProgrammePicker'
import { PronunciationCard } from './PronunciationCard'
import { classLabel } from '../../domain/programme'

const hm = (t?: string | null) => (t ? formatTime(toMinutes(t.slice(0, 5))) : '')

/** Where someone's app access stands (D36): the full words, a short form for cards, and its colour. */
export function accessStatus(p: Profile): { label: string; short: string; cls: string } {
  const invited = invitedLine(p)
  return !p.app_access ? { label: 'No app access', short: 'No app', cls: 'text-ink-3' }
    : p.user_id ? { label: 'Signed in', short: 'Signed in', cls: 'text-live' }
    : invited ? { label: invited, short: 'Invited', cls: 'text-info' }
    : { label: 'Not invited yet', short: 'Not invited', cls: 'text-warning' }
}

/**
 * Where someone's app access stands, said in words and colour, with Invite for someone who hasn't signed in yet
 * and, for anyone with an email, their email password (0041). onChanged reloads the list after a change.
 */
export function AccessState({ person, onInvite, onChanged }: { person: Profile; onInvite?: (p: Profile) => void; onChanged?: () => void }) {
  const [password, setPassword] = useState(false)
  const invited = invitedLine(person)
  const { label, cls } = accessStatus(person)
  const canInvite = !!onInvite && person.active && person.app_access && !person.user_id
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <span className={`inline-flex items-center gap-1.5 text-caption font-bold ${cls}`}><span className="size-2 rounded-full bg-current" aria-hidden />{label}</span>
      {canInvite && <Button size="md" variant="secondary" icon={<Send />} aria-label={`${invited ? 'Invite again' : 'Invite'} ${person.full_name}`} onClick={() => onInvite(person)}>{invited ? 'Invite again' : 'Invite'}</Button>}
      {onChanged && person.active && person.app_access && person.email && (
        <button type="button" className="iconbtn" aria-label={`Email password for ${person.full_name}`} title="Email password" onClick={() => setPassword(true)}><KeyRound /></button>
      )}
      {password && <PasswordSheet person={person} onClose={() => setPassword(false)} onDone={() => onChanged?.()} />}
    </span>
  )
}

/** The confirmation before anything that signs someone out or takes a child off the lists. */
function Confirm({ open, title, body, action, icon, busy, error, onYes, onNo }: { open: boolean; title: string; body: string; action: string; icon: ReactNode; busy: boolean; error: string | null; onYes: () => void; onNo: () => void }) {
  return (
    <Sheet open={open} onClose={onNo} title={title} description={body}>
      {error && <Notice tone="danger" className="mb-4">{error}</Notice>}
      <div className="grid gap-2.5 sm:grid-cols-2">
        <Button variant="secondary" onClick={onNo}>Cancel</Button>
        <Button variant="danger" icon={icon} loading={busy} onClick={onYes}>{action}</Button>
      </div>
    </Sheet>
  )
}

type Pending = { kind: 'access'; person: Profile } | { kind: 'remove'; person: Profile } | { kind: 'left' } | null

/**
 * A child's page (Screen Book v3, admin): class and programme with its windows and coordinators; parents and family with
 * their app access; edit details; and "has left the school".
 */
export function ChildPage({ dir, child, onBack, onChanged }: { dir: Directory; child: Child; onBack: () => void; onChanged: () => Promise<void> }) {
  const toast = useToast()
  const first = child.preferred_name ?? child.full_name.split(' ')[0]!
  const programme = dir.programmes.find((p) => p.id === child.programme_id)
  const extras = programmesOf(dir, child).filter((p) => p.id !== child.programme_id)
  const klass = dir.classes.find((c) => c.id === child.class_id)
  const coordinators = dir.coordinatorClasses.filter((a) => a.class_id === child.class_id).map((a) => dir.profiles.find((p) => p.id === a.profile_id)).filter((p): p is Profile => !!p?.active)
  const regular = dir.schedules.filter((s) => s.child_id === child.id)
  const people = dir.guardianships.filter((g) => g.child_id === child.id).map((g) => ({ g, p: dir.profiles.find((x) => x.id === g.guardian_id) })).filter((x): x is { g: typeof x.g; p: Profile } => !!x.p)
  const [sheet, setSheet] = useState<null | 'programme' | 'also' | 'add' | 'edit'>(null)
  const [pending, setPending] = useState<Pending>(null)
  const [inviting, setInviting] = useState<Profile | null>(null)
  const [editing, setEditing] = useState<{ person: Profile; relation: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [edit, setEdit] = useState({ name: child.full_name, dob: child.date_of_birth ?? '', gender: child.gender ?? null })
  const [editErrors, setEditErrors] = useState<Record<string, string>>({})

  /** Runs a change, refreshes the page and says so; true when it worked (the error shows in the open sheet otherwise). */
  async function run(fn: () => Promise<void>, done: string): Promise<boolean> {
    setBusy(true)
    setError(null)
    try {
      await fn()
      await onChanged()
      setPending(null)
      setSheet(null)
      toast(done)
      return true
    } catch (e) {
      setError(explainDbError(e as { code?: string; message?: string }))
      return false
    } finally {
      setBusy(false)
    }
  }

  function toggleAccess(p: Profile) {
    if (p.app_access) return setPending({ kind: 'access', person: p })
    if (!p.phone) return toast(`${p.full_name.split(' ')[0]} has no mobile yet. Edit them and add one to give app access.`)
    void run(() => setAppAccess(p.id, true), `${p.full_name.split(' ')[0]} can sign in with a code sent on WhatsApp to ${formatMobile(p.phone)}.`)
  }

  function saveEdit() {
    const e: Record<string, string> = {}
    if (edit.name.trim().split(/\s+/).length < 2) e.name = 'Enter the first and last name.'
    if (!edit.dob || edit.dob > new Date().toISOString().slice(0, 10)) e.dob = 'Check the date of birth.'
    setEditErrors(e)
    if (Object.keys(e).length) return
    void run(() => updateChild(child.id, { full_name: edit.name.trim().replace(/\s+/g, ' '), date_of_birth: edit.dob, gender: edit.gender }), 'Saved.')
  }

  const row = ({ g, p }: (typeof people)[number]) => (
    <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
      <Avatar name={p.full_name} color={g.kind === 'parent' ? 'var(--rb-blue)' : 'var(--ink-3)'} size="sm" />
      <div className="min-w-0 flex-1 basis-[160px]">
        <p className="truncate text-h4">{p.full_name}</p>
        <p className="truncate text-small font-semibold text-ink-2">
          {g.relation}{p.abroad ? ', lives outside India' : ''}{p.phone ? `, ${formatMobile(p.phone)}` : ''}
        </p>
      </div>
      <AccessState person={p} onInvite={setInviting} onChanged={() => void onChanged()} />
      <Switch on={p.app_access} label={`App access for ${p.full_name}`} busy={busy} onChange={() => toggleAccess(p)} />
      <button type="button" className="iconbtn" aria-label={`Edit ${p.full_name}`} onClick={() => setEditing({ person: p, relation: g.relation })}><PencilLine /></button>
      <Button size="md" variant="quiet" icon={<Trash2 />} aria-label={`Remove ${p.full_name}`} onClick={() => { setError(null); setPending({ kind: 'remove', person: p }) }} />
    </li>
  )
  const parents = people.filter((x) => x.g.kind === 'parent')
  const family = people.filter((x) => x.g.kind === 'family')

  return (
    <div className="page-in mt-4 grid gap-5">
      <Button size="md" variant="quiet" icon={<ChevronLeft />} className="justify-self-start" onClick={onBack}>Children</Button>
      <div className="flex flex-wrap items-center gap-4">
        <Avatar name={first} color={childColor(child.id)} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 className="text-h1 text-balance">{child.full_name}</h2>
          <p className="text-body text-ink-2">{child.date_of_birth
            ? `Born ${new Date(`${child.date_of_birth}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}, ${formatAge(child.date_of_birth)}`
            : <span className="font-bold text-warning">Date of birth not added yet</span>}</p>
        </div>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <section className="card grid gap-4 rounded-2xl p-5" aria-labelledby="class-h">
          <h3 id="class-h" className="kicker">Class and programme</h3>
          <div className="flex items-center gap-3.5">
            <span className="grid size-12 shrink-0 place-items-center rounded-md bg-accent-soft text-accent [&_svg]:size-6" aria-hidden>{programme ? levelIcon(levelOf(programme).level) : null}</span>
            <div className="min-w-0 flex-1">
              <p className="text-h3">{programme?.name ?? 'Programme not found'}</p>
              <p className="text-small font-semibold text-ink-2">{programme ? `${hm(programme.starts)} to ${hm(programme.ends)}` : ''}{klass ? `, class ${klass.name}` : ''}</p>
            </div>
            <Button size="md" variant="secondary" onClick={() => setSheet('programme')}>Change</Button>
          </div>
          {/* Programmes besides the class (D56): information only, they never limit when a child can come or go. */}
          <div className="grid gap-2.5 border-t border-line pt-4">
            <div className="flex items-center justify-between gap-3">
              <p className="kicker">Other programmes</p>
              <Button size="md" variant="secondary" icon={extras.length ? undefined : <Plus />} onClick={() => { setError(null); setSheet('also') }}>{extras.length ? 'Change' : 'Add'}</Button>
            </div>
            {extras.length ? (
              <ul className="grid gap-2.5">
                {extras.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 rounded-lg bg-sunken px-3.5 py-2.5">
                    <span className="grid size-9 shrink-0 place-items-center rounded-sm bg-surface text-accent [&_svg]:size-5" aria-hidden>{levelIcon(levelOf(p).level)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-h4">{classLabel(p.name)}</span>
                      <span className="block text-small font-semibold text-ink-2 tabular-nums">{hm(p.starts)} to {hm(p.ends)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-small font-semibold text-ink-2">None. Add After School or the Learning Center here.</p>}
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            {(['dropoff', 'pickup'] as const).map((d) => (
              <div key={d} className="rounded-lg bg-sunken px-3.5 py-2.5">
                <p className="kicker">{d === 'dropoff' ? 'Drop-off' : 'Pickup'}</p>
                <p className="mt-0.5 text-h4 tabular-nums">{regular[0] ? `Usually ${hm(regular[0][d])}` : 'Any time'}</p>
                <p className="text-caption font-semibold text-ink-2">{regular[0] ? 'Parents can still come at any time' : 'No regular time set'}</p>
              </div>
            ))}
          </div>
          <div>
            <p className="kicker">Gate team for {klass?.name ?? 'this class'}</p>
            <p className={`mt-1 text-small font-bold ${coordinators.length ? '' : 'text-warning'}`}>{coordinators.length ? coordinators.map((c) => c.full_name).join(', ') : 'Nobody yet, so it is announced to everyone'}</p>
          </div>
        </section>

        <PronunciationCard key={`${child.id}:${child.full_name}`} child={child} />

        <section className="card grid gap-2 rounded-2xl p-5" aria-labelledby="people-h">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="people-h" className="kicker">Parents and family</h3>
            <Button size="md" variant="secondary" icon={<UserPlus />} onClick={() => setSheet('add')}>Add a parent or relative</Button>
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-small font-bold text-ink-2 [&_svg]:size-4"><UserRound aria-hidden />Parents</p>
          {parents.length ? <ul className="divide-y divide-line">{parents.map(row)}</ul> : <p className="text-small font-semibold text-ink-3">No parent added.</p>}
          <p className="mt-2 flex items-center gap-1.5 text-small font-bold text-ink-2 [&_svg]:size-4"><Heart aria-hidden />Family who can collect</p>
          {family.length ? <ul className="divide-y divide-line">{family.map(row)}</ul> : <p className="text-small font-semibold text-ink-2">Nobody yet. If the parents live abroad, add the family {first} lives with.</p>}
          {parents.some((x) => x.p.abroad) && <Pill icon={<Globe />} className="mt-1">A parent lives outside India: they get every update, and the family here collects</Pill>}
          <p className="mt-2 text-caption font-semibold text-ink-2">Turning access off signs that person out everywhere.</p>
        </section>
      </div>

      <div className="flex flex-wrap gap-2.5 max-sm:[&>*]:flex-1">
        <Button size="md" variant="secondary" icon={<Pencil />} onClick={() => { setEdit({ name: child.full_name, dob: child.date_of_birth ?? '', gender: child.gender ?? null }); setEditErrors({}); setError(null); setSheet('edit') }}>Edit details</Button>
        <Button size="md" variant="danger" icon={<LogOut />} className="sm:ml-auto" onClick={() => { setError(null); setPending({ kind: 'left' }) }}>{first} has left the school</Button>
      </div>

      {sheet === 'programme' && (
        <ProgrammePicker open onClose={() => setSheet(null)} programmes={dir.programmes} childName={first} dateOfBirth={child.date_of_birth ?? ''} initial={child.programme_id}
          onPick={(id) => void run(() => setProgrammes(child.id, id, extras.map((p) => p.id).filter((x) => x !== id)), `${first} is now in ${dir.programmes.find((p) => p.id === id)?.name}.`)
            .then((ok) => ok || toast("Couldn't change the programme. Check the connection and try again."))} />
      )}
      {sheet === 'also' && (
        <AlsoInSheet onClose={() => setSheet(null)} programmes={dir.programmes} mainId={child.programme_id} initial={extras.map((p) => p.id)} childName={first} busy={busy} error={error}
          onSave={(ids) => void run(() => setProgrammes(child.id, child.programme_id, ids), ids.length ? `${first}'s programmes are saved.` : `${first} is in ${programme?.name ?? 'the class'} only.`)} />
      )}
      {sheet === 'add' && <AddGuardianSheet open dir={dir} child={child} onClose={() => setSheet(null)} onSaved={(m) => onChanged().then(() => { setSheet(null); toast(m) })} />}
      <Sheet open={sheet === 'edit'} onClose={() => setSheet(null)} title="Edit details" description="Changes show everywhere at once.">
        <div className="grid gap-4">
          {/* Same layout as Add a child. There is no "called" name (D59): the child is known by their own name. */}
          <TextField label="Full name" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} error={editErrors.name} />
          <div className="grid items-start gap-4 sm:grid-cols-2">
            <DateField label="Date of birth" value={edit.dob} max={new Date().toISOString().slice(0, 10)} onChange={(dob) => setEdit({ ...edit, dob })} error={editErrors.dob} startWith="years"
              hint={edit.dob ? formatAge(edit.dob) : undefined} />
            <GenderChoice value={edit.gender} onChange={(g) => setEdit({ ...edit, gender: g })} />
          </div>
          {error && <Notice tone="danger">{error}</Notice>}
        </div>
        <SheetFooter><Button size="xl" className="w-full" loading={busy} onClick={saveEdit}>Save</Button></SheetFooter>
      </Sheet>

      <Confirm open={pending?.kind === 'access'} busy={busy} error={error} icon={<Lock />} onNo={() => setPending(null)}
        title={pending?.kind === 'access' ? `Turn off app access for ${pending.person.full_name.split(' ')[0]}?` : ''}
        body={pending?.kind === 'access' ? `${pending.person.full_name.split(' ')[0]} is signed out everywhere at once. They stay listed, so the gate can still hand ${first} over to them.` : ''}
        action="Turn off access" onYes={() => pending?.kind === 'access' && void run(() => setAppAccess(pending.person.id, false), `${pending.person.full_name.split(' ')[0]} is signed out everywhere.`)} />
      <Confirm open={pending?.kind === 'remove'} busy={busy} error={error} icon={<Trash2 />} onNo={() => setPending(null)}
        title={pending?.kind === 'remove' ? `Remove ${pending.person.full_name.split(' ')[0]} from ${first}'s record?` : ''}
        body={`They can no longer collect ${first} from the gate or see ${first} in the app. Their other children stay as they are.`}
        action="Remove" onYes={() => pending?.kind === 'remove' && void run(() => removeGuardian(child.id, pending.person.id), `${pending.person.full_name.split(' ')[0]} is no longer listed for ${first}.`)} />
      <Confirm open={pending?.kind === 'left'} busy={busy} error={error} icon={<LogOut />} onNo={() => setPending(null)}
        title={`${first} has left the school?`}
        body={`${first} leaves every list today. Attendance is kept for the school's records. Parents with no other child here lose app access.`}
        action={`Yes, ${first} has left`} onYes={() => void run(() => childLeft(child.id), `${first} has been removed from today's lists.`).then((ok) => ok && onBack())} />
      {editing && <EditGuardianSheet dir={dir} child={child} person={editing.person} relation={editing.relation} onClose={() => setEditing(null)}
        onSaved={(m) => onChanged().then(() => { setEditing(null); toast(m) })} />}
      {inviting && <InviteSheet person={inviting} onClose={() => setInviting(null)} onDone={() => void onChanged()} />}
    </div>
  )
}
