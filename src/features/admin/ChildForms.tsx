import { useState, type ReactNode } from 'react'
import { Check, ChevronDown, ChevronRight, Glasses, Globe, HandHeart, Heart, Link2, Mail, Plus, ShieldUser, Smartphone, Trash2, UserPen, UserPlus, UserRound, UserRoundPlus, UsersRound } from '../../ui/icons'
import { Avatar } from '../../ui/Avatar'
import { Button } from '../../ui/Button'
import { TextField } from '../../ui/Field'
import { DateField } from '../../ui/DateField'
import { Sheet, SheetFooter } from '../../ui/Sheet'
import { Notice } from '../../ui/States'
import { Switch } from '../../ui/Switch'
import { childColor } from '../../ui/childColor'
import { formatMobile, normalizeMobile } from '../../domain/contact'
import { isEmail } from '../../../supabase/functions/_shared/passwordPattern'
import { addGuardian, explainDbError, saveChild, updatePerson, type Child, type Directory, type Profile } from './api'
import { ROLE } from './roles'
import { blankPerson, kindOf, linkByMobile, personErrors, RELATION_GROUPS, relationLabel, SIDED, someoneHere, toInput, type PersonDraft, type Side } from './family'
import { formatAge, levelOf, suggestedLevel } from './programmeCatalogue'
import { AlsoInSheet, levelIcon, ProgrammePicker } from './ProgrammePicker'
import { GenderChoice } from '../../ui/GenderChoice'
import { classLabel } from '../../domain/programme'

const RELATION_ICON: Record<string, ReactNode> = {
  Mother: <UserRound />, Father: <UserRound />, 'Legal guardian': <ShieldUser />, Grandmother: <Glasses />, Grandfather: <Glasses />,
  Aunt: <UsersRound />, Uncle: <UsersRound />, 'Elder sister': <HandHeart />, 'Elder brother': <HandHeart />, Cousin: <UserRoundPlus />, 'Other relative': <UserPen />,
}
const iconFor = (relation: string) => RELATION_ICON[relation.split(',')[0]!.trim()] ?? <UserPen />

/**
 * "How is this person related to Aarav?" (D26): parents, grandparents, aunts and uncles, older siblings, other family.
 * Grandparents, aunts and uncles can say which side. Returns the relation as it's stored ("Aunt, father's side").
 */
export function RelationPicker({ open, onClose, childName, initial, onUse }: { open: boolean; onClose: () => void; childName: string; initial?: string; onUse: (relation: string) => void }) {
  const [base, side0] = (initial ?? '').split(', ') as [string, string | undefined]
  const known = RELATION_GROUPS.some((g) => (g.relations as readonly string[]).includes(base))
  const [rel, setRel] = useState<string | null>(initial ? (known ? base : 'Other relative') : null)
  const [side, setSide] = useState<Side>((side0 as Side) ?? '')
  const [other, setOther] = useState(initial && !known ? initial : '')
  const [error, setError] = useState<string | null>(null)
  const label = rel ? relationLabel(rel, side, other) : ''

  function use() {
    if (!rel) return
    if (rel === 'Other relative' && other.trim().length < 3) return setError('Say how they are related, for example great-aunt.')
    onUse(label)
  }

  return (
    <Sheet open={open} onClose={onClose} title={`Their relation to ${childName || 'the child'}`} wide
      description="Parents and family can collect and use the app.">
      <div className="grid gap-5">
        {RELATION_GROUPS.map((g) => (
          <fieldset key={g.title}>
            <legend className="kicker mb-2.5">{g.title}</legend>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3" role="radiogroup" aria-label={g.title}>
              {g.relations.map((r) => (
                <button key={r} type="button" role="radio" aria-checked={rel === r} onClick={() => { setRel(r); if (!SIDED.includes(r)) setSide(''); setError(null) }}
                  className="choice flex min-h-14 min-w-0 flex-col items-start gap-1.5 px-3 py-2.5 text-left min-[400px]:flex-row min-[400px]:items-center min-[400px]:gap-2.5">
                  <span className={`grid size-8 shrink-0 place-items-center rounded-sm [&_svg]:size-4 sm:size-9 sm:[&_svg]:size-[18px] ${rel === r ? 'bg-accent text-on-accent' : 'bg-sunken text-ink-2'}`} aria-hidden>{iconFor(r)}</span>
                  <span className="min-w-0 text-h4 leading-tight [overflow-wrap:break-word]">{r}</span>
                </button>
              ))}
            </div>
          </fieldset>
        ))}
        {rel && SIDED.includes(rel) && (
          <fieldset>
            <legend className="kicker mb-2.5">Which side of the family? (optional)</legend>
            <div className="flex flex-wrap gap-2.5" role="radiogroup" aria-label="Side of the family">
              {(["mother's side", "father's side"] as const).map((v) => (
                <button key={v} type="button" role="radio" aria-checked={side === v} onClick={() => setSide(side === v ? '' : v)} className="choice h-12 px-5 text-h4">
                  {v[0]!.toUpperCase() + v.slice(1)}
                </button>
              ))}
            </div>
          </fieldset>
        )}
        {rel === 'Other relative' && (
          <TextField label="How are they related?" value={other} onChange={(e) => { setOther(e.target.value); setError(null) }} placeholder="For example, great-aunt" maxLength={40} error={error} autoFocus />
        )}
      </div>
      <SheetFooter>
        <p className="mb-2.5 flex items-center justify-center gap-2 text-small font-semibold text-ink-2 [&_svg]:size-4" aria-live="polite">
          {rel ? <>{iconFor(rel)}<span><b className="text-ink">{label || 'Other relative'}</b>, {kindOf(rel) === 'parent' ? 'added as a parent' : 'added as family'}</span></> : 'Choose a relation.'}
        </p>
        <Button size="xl" className="w-full" icon={<Check />} disabled={!rel} onClick={use}>{initial ? 'Save' : 'Continue'}</Button>
      </SheetFooter>
    </Sheet>
  )
}

type Errors = Record<string, string>

const phoneOf = (typed: string) => (typed.trim() ? normalizeMobile(typed) : null)

/** One parent or relative: name, mobile, app access, and "lives outside India" for parents. */
function PersonCard({ p, i, errors, onChange, onRemove, onRelation }: {
  p: PersonDraft; i: number; errors: Errors; onChange: (p: PersonDraft) => void; onRemove?: () => void; onRelation: () => void
}) {
  const parent = kindOf(p.relation) === 'parent'
  const who = p.name.trim() || (parent ? 'New parent' : 'New family member')
  const err = (k: string) => errors[`${k}.${i}`] ?? null
  const relationButton = (
    <button type="button" onClick={onRelation} className="choice flex h-11 items-center gap-2 px-3 text-small font-bold [&_svg]:size-4" aria-label={`Relation: ${p.relation}. Change it`}>
      {iconFor(p.relation)}<span className="max-w-[16ch] truncate">{p.relation}</span><ChevronDown className="text-ink-3" />
    </button>
  )
  return (
    <div className="grid gap-4 rounded-xl border border-line bg-canvas p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Avatar name={who} color={parent ? 'var(--rb-blue)' : 'var(--ink-3)'} size="sm" />
        <span className="min-w-0 flex-1 basis-[120px]">
          <span className="block truncate text-h4">{who}</span>
          {p.linkedNote && <span className="block text-caption font-semibold text-ink-2">{p.linkedNote}. Linked, not added twice.</span>}
        </span>
        {relationButton}
        {onRemove && <Button size="md" variant="quiet" icon={<Trash2 />} aria-label={`Remove ${who}`} onClick={onRemove} />}
      </div>
      {!p.linkedId && (
        <>
          <TextField label="Full name" value={p.name} onChange={(e) => onChange({ ...p, name: e.target.value })} placeholder={parent ? 'For example, Sneha Kulkarni' : 'For example, Asha Kulkarni'} error={err('name')} autoComplete="off" />
          <div className="grid gap-4">
            <TextField label={p.abroad ? 'Mobile, with country code' : p.appAccess ? 'Mobile, for the sign-in code' : 'Mobile'} type="tel" inputMode="tel" icon={<Smartphone aria-hidden />}
              value={p.phone} onChange={(e) => onChange({ ...p, phone: e.target.value })} placeholder={p.abroad ? '+971 50 123 4567' : '98765 43210'} error={err('phone')} />
          </div>
          <div className="flex items-center gap-2 rounded-lg bg-sunken py-1 pl-1 pr-3.5">
            <Switch on={p.appAccess} label={`App access for ${who}`} onChange={(v) => onChange({ ...p, appAccess: v })} />
            <p className="text-small font-semibold text-ink-2"><b className="text-ink">App access</b>, {p.appAccess ? `the sign-in code goes to their mobile on WhatsApp` : 'kept as a contact without the app'}</p>
          </div>
          {parent && (
            <div className="flex items-center gap-2 rounded-lg bg-sunken py-1 pl-1 pr-3.5">
              <Switch on={p.abroad} label="Lives outside India" onChange={(v) => onChange({ ...p, abroad: v })} />
              <p className="flex items-center gap-1.5 text-small font-semibold text-ink-2"><Globe className="size-4 shrink-0" aria-hidden /><span><b className="text-ink">Lives outside India</b>, {p.abroad ? 'gets every update; the family here collects' : 'collects in person'}</span></p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/**
 * Everyone at the school on a child's record, and the staff, to link instead of adding twice ("Already here for
 * Aarav", "Staff: Head office"). A staff member linked as a parent keeps their roles.
 */
function linkable(dir: Directory, exclude: Set<string>) {
  return dir.profiles.filter((p) => p.active && !exclude.has(p.id) && (dir.guardianships.some((g) => g.guardian_id === p.id) || !!dir.roles.get(p.id)?.length)).map((p) => {
    const kids = dir.guardianships.filter((g) => g.guardian_id === p.id).map((g) => dir.children.find((c) => c.id === g.child_id)).filter((c): c is Child => !!c?.active)
    const rel = dir.guardianships.find((g) => g.guardian_id === p.id)?.relation ?? ''
    const staff = dir.roles.get(p.id)?.map((r) => ROLE[r].name).join(', ')
    const note = rel ? `Already here for ${kids.map((k) => k.preferred_name ?? k.full_name.split(' ')[0]).join(' and ') || 'a child who has left'}` : `Staff: ${staff}`
    return { p, rel, note }
  })
}

/**
 * Add a child (Screen Book v3): the child, their class and programme, then parents and family, saved together or not at
 * all. Everyone with app access signs in with their mobile and a code sent on WhatsApp.
 */
export function AddChildSheet({ dir, open, onClose, onSaved }: { dir: Directory; open: boolean; onClose: () => void; onSaved: (childId: string, name: string) => void | Promise<void> }) {
  const [name, setName] = useState('')
  const [dob, setDob] = useState('')
  const [gender, setGender] = useState<'boy' | 'girl' | null>(null)
  const [programmeId, setProgrammeId] = useState<string | null>(null)
  const [also, setAlso] = useState<string[]>([])
  const [people, setPeople] = useState<PersonDraft[]>([blankPerson('Mother')])
  const [picker, setPicker] = useState<null | 'programme' | 'also' | { relationFor: number | 'new' }>(null)
  const [linking, setLinking] = useState(false)
  const [errors, setErrors] = useState<Errors>({})
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const today = new Date().toISOString().slice(0, 10)
  const who = (name.trim().split(/\s+/)[0] || '').trim()
  const programme = dir.programmes.find((p) => p.id === programmeId)
  const suggested = suggestedLevel(dob)
  const parents = people.map((p, i) => [p, i] as const).filter(([p]) => kindOf(p.relation) === 'parent')
  const family = people.map((p, i) => [p, i] as const).filter(([p]) => kindOf(p.relation) === 'family')
  const others = linkable(dir, new Set(people.map((p) => p.linkedId).filter(Boolean) as string[]))

  const update = (i: number, p: PersonDraft) => setPeople((list) => list.map((x, j) => (j === i ? p : x)))
  const remove = (i: number) => setPeople((list) => (list.length > 1 ? list.filter((_, j) => j !== i) : [blankPerson('Mother')]))

  async function save() {
    const e: Errors = {}
    const words = name.trim().split(/\s+/).filter(Boolean)
    if (words.length < 2) e.name = 'Enter the first and last name.'
    if (!dob) e.dob = 'Choose the date of birth.'
    else if (dob > today) e.dob = 'The date of birth cannot be in the future.'
    if (!programmeId) e.programme = 'Choose the class and programme.'
    const seen = new Set<string>()
    const ids = new Set<string>()
    const list = people.map((p) => linkByMobile(p, dir.profiles))
    list.forEach((p, i) => {
      const pe = personErrors(p, () => false)
      const n = p.linkedId ? null : phoneOf(p.phone)
      if ((n && seen.has(n)) || (p.linkedId && ids.has(p.linkedId))) pe.phone = 'Already on this list.'
      if (n) seen.add(n)
      if (p.linkedId) ids.add(p.linkedId)
      for (const [k, v] of Object.entries(pe)) e[`${k}.${i}`] = v
    })
    if (people.some((p) => !p.relation)) e.people = 'Choose how each person is related.'
    else if (!someoneHere(people)) e.people = 'Add at least one parent or relative who lives in India, to collect from the gate.'
    setErrors(e)
    if (Object.keys(e).length) return setFormError('Please check the highlighted fields.')
    setBusy(true)
    setFormError(null)
    try {
      const id = await saveChild({ full_name: words.join(' '), preferred_name: '', date_of_birth: dob, programme_id: programmeId!, also, gender }, list.map(toInput))
      // Busy until the parent has reloaded and opened the child: a second tap meanwhile would add the child twice.
      await onSaved(id, who)
    } catch (err) {
      setFormError(explainDbError(err as { code?: string; message?: string }))
    } finally {
      setBusy(false)
    }
  }

  const section = (icon: ReactNode, title: string, hint: string) => (
    <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h3 className="kicker flex items-center gap-1.5 [&_svg]:size-4">{icon}{title}</h3>
      <p className="text-caption font-semibold text-ink-3">{hint}</p>
    </div>
  )

  return (
    <Sheet open={open} onClose={onClose} title="Add a child" description="The child, parents and family are saved together, or not at all." wide>
      <div className="grid gap-4">
        <h3 className="kicker">The child</h3>
        {/* The child as the school will see them, filling in as the admin types: name, age and class at a glance. */}
        <section aria-label="The child" className="grid gap-4 rounded-2xl bg-sunken p-4 sm:p-5">
          <div className="flex items-center gap-3.5" aria-live="polite">
            <Avatar name={name.trim() || 'New child'} color={childColor(name.trim() || 'new child')} icon={name.trim() ? undefined : <UserRound />} size="lg" />
            <div className="min-w-0">
              <p className={`truncate text-h3 ${name.trim() ? '' : 'text-ink-3'}`}>{name.trim() || 'New child'}</p>
              <p className="truncate text-small font-semibold text-ink-2">
                {[dob && dob <= today ? formatAge(dob) : 'Age shows here', programme?.name ?? (suggested ? `${suggested.replace(' Program', '')} age` : null)].filter(Boolean).join(' · ')}
              </p>
            </div>
          </div>
          <TextField label="Full name" value={name} onChange={(e) => setName(e.target.value)} placeholder="First and last name, e.g. Aaradhya Sharma" autoComplete="off" error={errors.name} autoFocus />
          <div className="grid items-start gap-4 sm:grid-cols-2">
            <DateField label="Date of birth" max={today} value={dob} onChange={setDob} error={errors.dob} placeholder="Choose the date of birth" startWith="years"
              hint={dob && dob <= today ? `${formatAge(dob)} today${suggested ? `, ${suggested.replace(' Program', '')} age` : ''}` : undefined} />
            <GenderChoice value={gender} onChange={setGender} />
          </div>
        </section>

        <h3 className="kicker mt-2">Class and programme</h3>
        <button type="button" onClick={() => setPicker('programme')} className={`choice flex w-full items-center gap-3.5 p-3.5 text-left ${errors.programme ? '[--edge:var(--danger)]' : ''}`} aria-describedby={errors.programme ? 'programme-msg' : undefined}>
          <span className="grid size-11 shrink-0 place-items-center rounded-sm bg-accent-soft text-accent [&_svg]:size-[22px]" aria-hidden>{programme ? levelIcon(levelOf(programme).level) : <Plus />}</span>
          <span className="min-w-0 flex-1">
            <span className="block text-h4">{programme ? classLabel(programme.name) : 'Choose the class'}</span>
            <span className="block text-small font-semibold text-ink-2">{programme ? 'Change' : suggested ? `${suggested.replace(' Program', '')} is suggested from the date of birth` : 'The class, then the programme'}</span>
          </span>
          <ChevronRight className="size-5 shrink-0 text-ink-3" aria-hidden />
        </button>
        {errors.programme && <p id="programme-msg" className="-mt-2 px-0.5 text-small font-bold text-danger" role="alert">{errors.programme}</p>}
        {programme && (
          <button type="button" onClick={() => setPicker('also')} className="choice flex w-full items-center gap-3.5 p-3.5 text-left">
            <span className={`grid size-11 shrink-0 place-items-center rounded-sm [&_svg]:size-[22px] ${also.length ? 'bg-accent-soft text-accent' : 'bg-sunken text-ink-2'}`} aria-hidden>
              {(() => { const p = dir.programmes.find((x) => x.id === also[0]); return p ? levelIcon(levelOf(p).level) : <Plus /> })()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-h4">{also.length ? `Also in ${also.map((id) => dir.programmes.find((p) => p.id === id)?.name).filter(Boolean).join(' + ')}` : 'Other programmes'}</span>
              <span className="block text-small font-semibold text-ink-2">{also.length ? 'Change' : 'Optional: After School, Learning Center and more'}</span>
            </span>
            <ChevronRight className="size-5 shrink-0 text-ink-3" aria-hidden />
          </button>
        )}

        {section(<UserRound />, 'Parents', 'Mother, father or legal guardian')}
        {parents.length ? parents.map(([p, i]) => <PersonCard key={p.key} p={p} i={i} errors={errors} onChange={(x) => update(i, x)} onRemove={people.length > 1 ? () => remove(i) : undefined} onRelation={() => setPicker({ relationFor: i })} />)
          : <p className="text-small font-semibold text-ink-2">No parent yet. Add one, or the family the child lives with.</p>}
        {section(<Heart />, 'Family who can collect', 'Grandparents, aunts, uncles, older siblings')}
        {family.length ? family.map(([p, i]) => <PersonCard key={p.key} p={p} i={i} errors={errors} onChange={(x) => update(i, x)} onRemove={() => remove(i)} onRelation={() => setPicker({ relationFor: i })} />)
          : <p className="text-small font-semibold text-ink-2">If the parents live abroad, add the family {who || 'the child'} lives with. They collect from the gate and can have the app.</p>}
        {errors.people && <Notice tone="danger">{errors.people}</Notice>}
        <div className="flex flex-wrap gap-2.5">
          <Button size="md" variant="secondary" icon={<UserPlus />} onClick={() => setPicker({ relationFor: 'new' })}>Add a parent or relative</Button>
          <Button size="md" variant="quiet" icon={<Link2 />} aria-expanded={linking} onClick={() => setLinking(!linking)}>Link someone already here</Button>
        </div>
        {linking && (
          others.length ? (
            <ul className="grid gap-2 sm:grid-cols-2">
              {others.map(({ p, rel, note }) => (
                <li key={p.id}>
                  <button type="button" className="choice flex w-full items-center gap-3 p-3 text-left"
                    onClick={() => {
                      const kept = people.filter((x) => x.linkedId || x.name || x.phone)
                      setPeople([...kept, { ...blankPerson(rel), name: p.full_name, linkedId: p.id, linkedNote: note }])
                      setLinking(false)
                      // Staff have no relation to copy: ask for it straight away.
                      if (!rel) setPicker({ relationFor: kept.length })
                    }}>
                    <Avatar name={p.full_name} color={childColor(p.id)} size="sm" />
                    <span className="min-w-0"><span className="block truncate text-h4">{p.full_name}</span><span className="block truncate text-caption font-semibold text-ink-2">{rel}. {note}</span></span>
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="text-small font-semibold text-ink-2">Everyone at the school is already listed here.</p>
        )}
      </div>
      {formError && <Notice tone="danger" className="mt-5">{formError}</Notice>}
      <SheetFooter>
        <Button size="xl" className="w-full" icon={<Plus />} loading={busy} onClick={() => void save()}>Add {who || 'child'}</Button>
        <p className="mt-2.5 text-center text-caption font-semibold text-ink-3">Everyone with app access signs in with a code sent on WhatsApp.</p>
      </SheetFooter>

      {picker === 'programme' && (
        <ProgrammePicker open onClose={() => setPicker(null)} programmes={dir.programmes} childName={who} dateOfBirth={dob} initial={programmeId}
          onPick={(id) => { setProgrammeId(id); setAlso((a) => a.filter((x) => x !== id)); setPicker(null); setErrors(({ programme: _, ...rest }) => rest) }} />
      )}
      {picker === 'also' && programmeId && (
        <AlsoInSheet onClose={() => setPicker(null)} programmes={dir.programmes} mainId={programmeId} initial={also} childName={who}
          onSave={(ids) => { setAlso(ids); setPicker(null) }} />
      )}
      {picker && typeof picker === 'object' && (
        <RelationPicker open onClose={() => setPicker(null)} childName={who} initial={picker.relationFor === 'new' ? undefined : people[picker.relationFor]?.relation}
          onUse={(relation) => {
            if (picker.relationFor === 'new') setPeople((list) => [...list, blankPerson(relation)])
            else update(picker.relationFor, { ...people[picker.relationFor]!, relation, abroad: kindOf(relation) === 'parent' && people[picker.relationFor]!.abroad })
            setPicker(null)
          }} />
      )}
    </Sheet>
  )
}

/** Add a parent or relative on the child's page: the relation first, then their details. */
export function AddGuardianSheet({ dir, child, open, onClose, onSaved }: { dir: Directory; child: Child; open: boolean; onClose: () => void; onSaved: (message: string) => void | Promise<void> }) {
  const first = child.preferred_name ?? child.full_name.split(' ')[0]!
  const [p, setP] = useState<PersonDraft | null>(null)
  const [errors, setErrors] = useState<Errors>({})
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [relationOpen, setRelationOpen] = useState(false)
  const listed = new Set(dir.guardianships.filter((g) => g.child_id === child.id).map((g) => g.guardian_id))

  if (!p) return <RelationPicker open={open} onClose={onClose} childName={first} onUse={(relation) => setP(blankPerson(relation))} />
  const parent = kindOf(p.relation) === 'parent'

  async function save() {
    const q = linkByMobile(p!, dir.profiles)
    // A number held by someone turned off moves to this person (0049).
    const pe = personErrors(q, () => false)
    if (q.linkedId && listed.has(q.linkedId)) pe.phone = `Already on ${first}'s record.`
    const e: Errors = Object.fromEntries(Object.entries(pe).map(([k, v]) => [`${k}.0`, v]))
    setErrors(e)
    if (Object.keys(e).length) return
    setBusy(true)
    setFormError(null)
    try {
      await addGuardian(child.id, toInput(q))
      const name = q.name.trim().split(' ')[0]
      await onSaved(q.linkedId ? `${name} added for ${first}, with the same sign-in.` : q.appAccess ? `${name} added. Tap Invite to send them the link.` : `${name} added. They can collect ${first} from the gate.`)
    } catch (err) {
      setFormError(explainDbError(err as { code?: string; message?: string }))
    } finally {
      setBusy(false)
    }
  }

  const others = linkable(dir, listed)
  return (
    <Sheet open={open} onClose={onClose} title={`Add ${parent ? 'a parent' : 'family'} for ${first}`}
      description={parent ? 'With app access on, they get an invitation code and see only their own children.' : `${p.relation}. They collect ${first} from the gate without a link, and can have the app.`}>
      <PersonCard p={p} i={0} errors={errors} onChange={setP} onRelation={() => setRelationOpen(true)} />
      {others.length > 0 && !p.linkedId && (
        <details className="mt-4">
          <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-small font-bold text-accent-ink"><Link2 className="size-4" aria-hidden />Or link someone already here</summary>
          <ul className="mt-2 grid gap-2">
            {others.map(({ p: o, note }) => (
              <li key={o.id}><button type="button" className="choice flex w-full items-center gap-3 p-3 text-left" onClick={() => setP({ ...p, name: o.full_name, linkedId: o.id, linkedNote: note })}>
                <Avatar name={o.full_name} color={childColor(o.id)} size="sm" /><span className="min-w-0"><span className="block truncate text-h4">{o.full_name}</span><span className="block truncate text-caption font-semibold text-ink-2">{note}</span></span>
              </button></li>
            ))}
          </ul>
        </details>
      )}
      {formError && <Notice tone="danger" className="mt-4">{formError}</Notice>}
      <SheetFooter>
        <Button size="xl" className="w-full" icon={<UserPlus />} loading={busy} onClick={() => void save()}>Add {p.relation.split(',')[0]!.toLowerCase()}</Button>
      </SheetFooter>
      {relationOpen && <RelationPicker open onClose={() => setRelationOpen(false)} childName={first} initial={p.relation}
        onUse={(relation) => { setP({ ...p, relation, abroad: kindOf(relation) === 'parent' && p.abroad }); setRelationOpen(false) }} />}
    </Sheet>
  )
}

/** Edit a parent or relative on the child's page: every detail, and how they're related. Opens filled in. */
export function EditGuardianSheet({ dir, child, person, relation, onClose, onSaved }: {
  dir: Directory; child: Child; person: Profile; relation: string; onClose: () => void; onSaved: (message: string) => void | Promise<void>
}) {
  const first = child.preferred_name ?? child.full_name.split(' ')[0]!
  const [p, setP] = useState<PersonDraft>({ key: person.id, name: person.full_name, phone: person.phone ?? '', abroad: person.abroad, appAccess: person.app_access, relation })
  const [errors, setErrors] = useState<Errors>({})
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [relationOpen, setRelationOpen] = useState(false)
  const [email, setEmail] = useState(person.email ?? '')
  const phones = new Set(dir.profiles.filter((x) => x.id !== person.id && x.active).map((x) => x.phone).filter(Boolean) as string[])
  const signedIn = !!person.user_id

  async function save() {
    const pe = personErrors(p, (n) => phones.has(n))
    const e: Errors = Object.fromEntries(Object.entries(pe).map(([k, v]) => [`${k}.0`, v === 'Already here. Use Link someone already here.' ? 'Someone else here already uses this mobile.' : v]))
    if (email.trim() && !isEmail(email)) e.email = "That email doesn't look right."
    setErrors(e)
    if (Object.keys(e).length) return
    setBusy(true)
    setFormError(null)
    try {
      await updatePerson(person.id, child.id, { ...toInput(p), email: email.trim().toLowerCase() || null } as Parameters<typeof updatePerson>[2])
      const changed = phoneOf(p.phone)
      await onSaved(signedIn && changed && changed !== person.phone ? `Saved. ${p.name.trim().split(' ')[0]}'s sign-in code now goes to ${formatMobile(changed)}.` : 'Saved.')
    } catch (err) {
      setFormError(explainDbError(err as { code?: string; message?: string }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open onClose={onClose} title={`Edit ${person.full_name.split(' ')[0]}`} description={`${relation} of ${first}. Changes show everywhere at once.`}>
      <PersonCard p={p} i={0} errors={errors} onChange={setP} onRelation={() => setRelationOpen(true)} />
      <div className="mt-4">
        <TextField label="Email, for email sign-in (optional)" type="email" inputMode="email" autoCapitalize="none" spellCheck={false} icon={<Mail aria-hidden />}
          value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" error={errors.email}
          hint="Email sign-in starts only when you turn it on with the key button. A new email ends any password they have." />
      </div>
      {signedIn && phoneOf(p.phone) && phoneOf(p.phone) !== person.phone && (
        <Notice className="mt-4">{person.full_name.split(' ')[0]} has signed in before. From now on they sign in with the new mobile.</Notice>
      )}
      {formError && <Notice tone="danger" className="mt-4">{formError}</Notice>}
      <SheetFooter><Button size="xl" className="w-full" icon={<Check />} loading={busy} onClick={() => void save()}>Save changes</Button></SheetFooter>
      {relationOpen && <RelationPicker open onClose={() => setRelationOpen(false)} childName={first} initial={p.relation}
        onUse={(r) => { setP({ ...p, relation: r, abroad: kindOf(r) === 'parent' && p.abroad }); setRelationOpen(false) }} />}
    </Sheet>
  )
}
