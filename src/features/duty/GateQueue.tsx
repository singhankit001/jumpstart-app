import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { preconnect } from 'react-dom'
import { BellRing, CircleCheck, DoorOpen, Eye, Headset, House, KeyRound, Link2, Lock, MapPin, Navigation, Phone, RotateCcw, School, Timer, TriangleAlert, UserCheck } from '../../ui/icons'
import { Avatar } from '../../ui/Avatar'
import { Button, LuxButton } from '../../ui/Button'
import { Pill } from '../../ui/Pill'
import { Sheet } from '../../ui/Sheet'
import { ErrorState, Notice, SkeletonList } from '../../ui/States'
import { useToast } from '../../ui/Toast'
import { childColor } from '../../ui/childColor'
import { useNow } from '../../ui/hooks'
import { supabase } from '../../lib/supabase'
import { onTableChange } from '../../lib/live'
import { useSession } from '../auth/session'
import { explainTripError, gateStep, useTodayTrips, type GateStep, type Trip } from '../trips/api'
import { clockTime } from '../trips/rules'
import { formatMobile } from '../../domain/contact'
import { CodeSheet } from './CodeSheet'
import { ClassRoster } from './GateExtras'
import { Tabs } from '../../ui/Tabs'
import { CallSheet } from '../school/CallSheet'
import { useSchoolDay } from '../school/useSchoolDay'
import type { Announcer } from './announcer'
import { loadVoiceVersion, setVoiceChildren, warmClips } from './voiceClips'
import type { VoiceChild } from '../../../supabase/functions/_shared/announce.ts'
import { childMessages, commonPhrases } from '../../../supabase/functions/_shared/gateAnnounce.ts'
import { isLate, settled, shouldAnnounce, syncGate, type GateChild } from './gate'
import { RequestPopup } from './RequestPopup'
import { setVoiceOpenings } from './sound'
import { useGateSettings } from './useGateSettings'
import { classLabel } from '../../domain/programme'

interface Guardian { id: string; name: string; relation: string; active: boolean; kind: 'parent' | 'family'; abroad: boolean }
interface GateData {
  children: Map<string, GateChild & { guardians: Guardian[]; spoken: string | null }>
  myClasses: Set<string>
  /** Who could cover each class for this tablet (see useGateData); it counts as covered only while one is on duty. */
  assigned: Array<{ profileId: string; classId: string }>
}

/**
 * Who can be heard at the gate now (0051, 0061: Active duty, audible, checked in within 75 s): this phone checks in every
 * 30 seconds and on return to the screen, and says it can't be heard when the duty screen closes. Duty itself is
 * untouched by all of this. Null until the first answer, or when the server can't say: then a class counts
 * as covered by whoever is assigned, as before.
 */
function useOnDuty(audible: boolean): Set<string> | null {
  const [ids, setIds] = useState<Set<string> | null>(null)
  useEffect(() => {
    let stopped = false
    // Muted or with sound paused, this phone can't be heard: it checks in as off duty, so the others speak its classes.
    const beat = async () => {
      // Reachability only (0061): never starts, pauses or ends duty.
      const { data, error } = await supabase.rpc('gate_heartbeat', { p_on: audible, p_start: false })
      // A failed check-in keeps the last list, so classes don't flip between covered and not.
      if (!stopped && !error && Array.isArray(data)) setIds(new Set(data as string[]))
    }
    void beat()
    const every = setInterval(() => void beat(), 30_000)
    const onVisible = () => { if (document.visibilityState === 'visible') void beat() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      clearInterval(every)
      document.removeEventListener('visibilitychange', onVisible)
      void supabase.rpc('gate_heartbeat', { p_on: false, p_start: false }).then(() => {}, () => {})
    }
  }, [audible])
  return ids
}

const TRIP_PARAM = /^[0-9a-f-]{36}$/i
/** The request a notification opened (?trip=…), or null. */
export function tripFromUrl(url: string = location.pathname + location.search): string | null {
  const id = new URL(url, location.origin).searchParams.get('trip')
  return id && TRIP_PARAM.test(id) ? id : null
}

/** Center Coordinators check in and hand over; Center Leaders hear, acknowledge and mark Ready (0038, enforced by the database). */
function useCanClose(): boolean {
  const { state } = useSession()
  return state.status === 'signed-in' && !!state.me?.roles.includes('coordinator')
}

/** The children, their guardians and who covers which class: everything the gate needs besides the trips. */
function useGateData() {
  const { state } = useSession()
  const myId = state.status === 'signed-in' ? state.me?.profile_id : undefined
  const canClose = useCanClose()
  const [data, setData] = useState<GateData | null>(null)
  const [error, setError] = useState(false)
  const load = useCallback(async () => {
    const [kids, people, assigned, voices, gateRoles] = await Promise.all([
      supabase.from('children').select('id, full_name, preferred_name, gender, class_id, classes(name), programmes!children_programme_id_fkey(name), guardianships(guardian_id, relation, kind)').eq('active', true),
      supabase.from('profiles').select('id, full_name, active, abroad'),
      supabase.from('coordinator_classes').select('profile_id, class_id'),
      // Separate, and its failure ignored: the gate works without pronunciations (names are then said as registered).
      supabase.from('child_pronunciations').select('child_id, spoken_name'),
      supabase.from('staff_roles').select('profile_id, role').in('role', ['coordinator', 'leader']),
    ])
    if (kids.error || people.error || assigned.error || gateRoles.error) return setError(true)
    setError(false)
    const spoken = new Map(((voices.data ?? []) as Array<{ child_id: string; spoken_name: string | null }>).map((v) => [v.child_id, v.spoken_name]))
    const names = new Map((people.data ?? []).map((p) => [p.id as string, p as { id: string; full_name: string; active: boolean; abroad: boolean }]))
    type Kid = { id: string; full_name: string; preferred_name: string | null; gender: string | null; class_id: string; classes: { name: string } | null; programmes: { name: string } | null; guardianships: Array<{ guardian_id: string; relation: string; kind: 'parent' | 'family' }> }
    const children = new Map(((kids.data ?? []) as unknown as Kid[]).map((c) => [c.id, {
      id: c.id, name: c.preferred_name ?? c.full_name.split(' ')[0]!, gender: c.gender, fullName: c.full_name, classId: c.class_id,
      className: c.programmes?.name ? classLabel(c.programmes.name) : c.classes?.name ?? '', programmeName: c.programmes?.name ?? '', spoken: spoken.get(c.id) ?? null,
      guardians: c.guardianships.map((g) => ({ id: g.guardian_id, name: names.get(g.guardian_id)?.full_name ?? 'Guardian', relation: g.relation, active: names.get(g.guardian_id)?.active ?? false, kind: g.kind ?? 'parent', abroad: names.get(g.guardian_id)?.abroad ?? false })),
    }]))
    // The voice says each child's name the way the school approved (D50); the screen always shows it as registered.
    setVoiceChildren(new Map([...children.values()].map((c) => [c.id, { fullName: c.fullName, name: c.name, spoken: c.spoken } satisfies VoiceChild])))
    const rows = (assigned.data ?? []) as Array<{ profile_id: string; class_id: string }>
    // A class counts as covered for this tablet when someone who can do what it does is assigned: for a Center
    // Coordinator, another coordinator; for a Center Leader, anyone on the gate team. Same rule as push (0038).
    const coordinators = new Set(((gateRoles.data ?? []) as Array<{ profile_id: string; role: string }>).filter((r) => r.role === 'coordinator').map((r) => r.profile_id))
    const covering = rows.filter((r) => !canClose || coordinators.has(r.profile_id)).map((r) => ({ profileId: r.profile_id, classId: r.class_id }))
    setData({ children, myClasses: new Set(rows.filter((r) => r.profile_id === myId).map((r) => r.class_id)), assigned: covering })
  }, [myId, canClose])
  useEffect(() => {
    void load()
    const stops = ['children', 'guardianships', 'coordinator_classes', 'child_pronunciations', 'staff_roles'].map((t) => onTableChange(t, () => void load()))
    // Changes missed while the live connection was down (iOS suspends it in the background) are fetched on return.
    const onVisible = () => document.visibilityState === 'visible' && void load()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onVisible)
    return () => { stops.forEach((s) => s()); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('online', onVisible) }
  }, [load])
  return { data, error, reload: load }
}

/** What this person does next with a trip, or null when the rest is a Center Coordinator's (check in, hand over). */
// The parent tapped I've arrived after the gate last acknowledged: new news, acknowledged again (0052).
const arrivedSinceSeen = (t: Trip) => !!t.arrived_at && !!t.acknowledged_at && Date.parse(t.arrived_at) > Date.parse(t.acknowledged_at)

function nextStep(t: Trip, canClose: boolean): { step: GateStep | 'handover'; label: string; icon: ReactNode } | null {
  if ((t.off_schedule && !t.acknowledged_at) || (!canClose && arrivedSinceSeen(t))) return { step: 'acknowledge', label: 'Acknowledge', icon: <Eye /> }
  if (t.direction === 'dropoff') return canClose ? { step: 'close', label: 'Check in', icon: <DoorOpen /> } : t.acknowledged_at ? null : { step: 'acknowledge', label: 'Acknowledge', icon: <Eye /> }
  if (!t.ready_at) return { step: 'ready', label: 'Ready', icon: <CircleCheck /> }
  if (!canClose) return null
  return t.traveller_kind === 'third_person' ? { step: 'handover', label: 'Enter code', icon: <KeyRound /> } : { step: 'handover', label: 'Hand over', icon: <UserCheck /> }
}

const relationName = (t: Trip) => [t.traveller_relation, t.traveller_name.split(' ')[0]].filter(Boolean).join(', ')

/** "1.2 km away" or "At the gate": straight-line, never a time (no route or traffic). */

/**
 * The live gate queue on the coordinator's iPad (J4, J5, ANN-1): today's drop-offs and pickups as they come in,
 * announced aloud, with the steps at the gate. Handover goes only to a registered guardian (D4), checked by the server.
 */
export function GateQueue({ announcer, audible = true, paused = false }: { announcer: Announcer; audible?: boolean; /** Duty paused (0061): the queue stays on screen, but nothing pops up. */ paused?: boolean }) {
  // The gate voice's requests go to the functions on this origin: open the connection before the first announcement.
  if (import.meta.env.VITE_SUPABASE_URL) preconnect(import.meta.env.VITE_SUPABASE_URL)
  const toast = useToast()
  const canClose = useCanClose()
  const trips = useTodayTrips()
  const gate = useGateData()
  const onDuty = useOnDuty(audible)
  // Covered: someone assigned who is on duty now. A class whose coordinator isn't is announced here straight away.
  const covered = new Set((gate.data?.assigned ?? []).filter((a) => !onDuty || onDuty.has(a.profileId)).map((a) => a.classId))
  const nowMs = useNow(5_000)
  const [picked, setPicked] = useState<string | null>(() => tripFromUrl())
  // Taken off the address once read, so a reload doesn't open it again.
  useEffect(() => { if (tripFromUrl()) history.replaceState(history.state, '', location.pathname) }, [])
  // A tapped notification for this screen (public/push-sw.js) names its request without reloading the page.
  useEffect(() => {
    const onOpen = (e: MessageEvent) => {
      const d = e.data as { type?: string; url?: string } | null
      const id = d?.type === 'jumpstart-open' && d.url ? tripFromUrl(d.url) : null
      if (id) { setPicked(id); void trips.reload() }
    }
    navigator.serviceWorker?.addEventListener('message', onOpen)
    return () => navigator.serviceWorker?.removeEventListener('message', onOpen)
  }, [trips.reload])
  const [busy, setBusy] = useState<string | null>(null)
  const [handover, setHandover] = useState<Trip | null>(null)
  const [codeFor, setCodeFor] = useState<Trip | null>(null)
  const [locked, setLocked] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const school = useSchoolDay()
  const [scope, setScope] = useState<'mine' | 'all'>('mine')
  const [calling, setCalling] = useState(false)
  const [errorTrip, setErrorTrip] = useState<string | null>(null)
  // "Later" on the pop-up, per trip: hidden until the next reminder, or sooner when the trip changes (I've arrived).
  const [later, setLater] = useState<Map<string, { version: string; until: number }>>(new Map())
  const cancelHeard = useRef(new Set<string>())
  const announced = useRef(new Map<string, string>())
  const lateHeard = useRef(new Map<string, string>())
  const listeningSince = useRef(Date.now())
  // The admin's wording and timings (0042). A change applies from the next announcement; one being said finishes.
  const { settings: cfg, failed: settingsFailed } = useGateSettings()
  const cfgRef = useRef(cfg)
  cfgRef.current = cfg
  useEffect(() => {
    announcer.configure({ openings: { new: cfg.opening_new, urgent: cfg.opening_urgent, reminder: cfg.opening_reminder }, repeatMs: cfg.reminder_min * 60_000 })
    setVoiceOpenings([cfg.opening_new, cfg.opening_urgent, cfg.opening_reminder])
  }, [cfg, announcer])

  // Your classes (and any class nobody covers), or the whole school. Announcements follow their own rule (shouldAnnounce).
  const inScope = (childId: string) => {
    const c = gate.data?.children.get(childId)
    return scope === 'all' || !c || gate.data!.myClasses.has(c.classId) || !covered.has(c.classId)
  }
  const sections = useMemo(() => {
    const all = (trips.trips ?? []).filter((t) => inScope(t.child_id))
    const open = all.filter((t) => t.status === 'en_route')
    return {
      attention: open.filter((t) => t.off_schedule && !t.acknowledged_at),
      coming: open.filter((t) => !(t.off_schedule && !t.acknowledged_at)),
      done: all.filter((t) => t.status !== 'en_route').sort((a, b) => Date.parse(b.closed_at ?? b.updated_at) - Date.parse(a.closed_at ?? a.updated_at)),
    }
  }, [trips.trips, scope, gate.data])

  // The gate never sees anyone's location (D38): only the expected time, and the steps at the gate.

  // On duty, this iPad copies every child's announcements (made ahead by the school) so a parent's tap plays from the
  // iPad itself, even without Wi-Fi. A few megabytes once; after that almost everything is already here. Again whenever
  // a child, a relation or a pronunciation changes. Copying never makes a clip or spends characters.
  const warmFor = useMemo(() => {
    if (!gate.data) return []
    const list = commonPhrases(cfg)
    for (const c of gate.data.children.values()) {
      list.push(...childMessages(cfg, { fullName: c.fullName, name: c.name, programme: c.programmeName, spoken: c.spoken }, c.guardians.filter((g) => g.active).map((g) => g.relation)))
    }
    return list
  }, [gate.data, cfg])
  useEffect(() => {
    if (!warmFor.length) return
    const stop = new AbortController()
    void loadVoiceVersion().then(() => { if (!stop.signal.aborted) void warmClips(warmFor, stop.signal) })
    return () => stop.abort()
  }, [warmFor])

  // Announcements follow the trips (syncGate in gate.ts): new ones play, again at each of the admin's stages, with
  // reminders saying the time left at that moment; a new time or a cancellation replaces what was queued.
  useEffect(() => {
    if (!trips.trips || !gate.data) return
    syncGate(trips.trips, { ...gate.data, covered }, nowMs, cfg, () => cfgRef.current, { announced: announced.current, cancelHeard: cancelHeard.current, lateHeard: lateHeard.current, since: listeningSince.current }, announcer)
  }, [trips.trips, gate.data, onDuty, nowMs, announcer, cfg])

  // Tells the service worker which requests this screen is announcing aloud right now, so their push alert doesn't sound
  // on top of the voice. Nothing while muted or with sound paused; cleared when the duty screen closes.
  useEffect(() => {
    const ids = audible ? [...announced.current.keys()] : []
    navigator.serviceWorker?.controller?.postMessage({ type: 'jumpstart-announcing', on: audible, trips: ids })
  }, [audible, trips.trips, gate.data, onDuty, nowMs])
  useEffect(() => () => navigator.serviceWorker?.controller?.postMessage({ type: 'jumpstart-announcing', on: false }), [])
  // Alerts still on this device's lock screen for requests that have been handled since are taken down.
  useEffect(() => {
    const done = new Set((trips.trips ?? []).filter(settled).map((t) => `trip-${t.id}`))
    if (!done.size) return
    void navigator.serviceWorker?.getRegistration().then((reg) => reg?.getNotifications()).then((shown) => {
      for (const n of shown ?? []) if (done.has(n.tag)) n.close()
    }).catch(() => {})
  }, [trips.trips])

  async function act(t: Trip, step: GateStep, handedTo?: string) {
    setBusy(t.id)
    setError(null)
    setErrorTrip(t.id)
    try {
      await gateStep(t.id, step, handedTo)
      await trips.reload()
      const child = gate.data?.children.get(t.child_id)
      const name = child?.name ?? 'The child'
      toast(step === 'acknowledge' ? `Seen: ${name}'s ${t.direction === 'pickup' ? 'pickup' : 'drop-off'}.`
        : step === 'ready' ? `${name} is ready. The parent has been told.`
        : t.direction === 'pickup' ? `${name} handed over.` : `${name} checked in.`)
      if (step === 'close') setHandover(null)
    } catch (e) {
      setError(explainTripError(e as { code?: string; message?: string }))
    } finally {
      setBusy(null)
    }
  }

  const openHandover = (t: Trip) => (t.traveller_kind === 'third_person' ? setCodeFor(t) : setHandover(t))
  const doNext = (t: Trip) => {
    const n = nextStep(t, canClose)
    if (!n) return
    if (n.step === 'handover') return openHandover(t)
    void act(t, n.step)
  }

  if ((trips.error && !trips.trips) || (gate.error && !gate.data)) {
    return <ErrorState title="Couldn't load the queue" onRetry={() => { void trips.reload(); void gate.reload() }}>Check this device's connection. Announcements pause until it's back.</ErrorState>
  }
  if (!trips.trips || !gate.data) return <SkeletonList count={3} className="grid gap-3" />

  const children = gate.data.children
  const selected = trips.trips.find((t) => t.id === picked) ?? sections.attention[0] ?? sections.coming[0] ?? null

  const Row = ({ t }: { t: Trip }) => {
    const c = children.get(t.child_id)
    const done = t.status !== 'en_route'
    const n = done ? null : nextStep(t, canClose)
    const mine = c ? gate.data!.myClasses.has(c.classId) : false
    return (
      <li>
        <div className={`card flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl p-3 pr-3.5 transition-shadow duration-200 ${selected?.id === t.id ? 'shadow-[0_0_0_2px_var(--accent),var(--shadow-card)]' : ''} ${done ? 'opacity-70' : ''}`}>
          <button type="button" className="flex min-w-0 flex-1 basis-[200px] items-center gap-3 text-left" onClick={() => setPicked(t.id)} aria-label={`${c?.fullName ?? 'Child'}: details`}>
            <Avatar name={c?.name ?? '?'} color={childColor(t.child_id)} />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2">
                <span className="truncate text-h3">{c?.fullName ?? 'Child'}</span>
                <span className="shrink-0 text-small font-bold text-ink-2 tabular-nums">{clockTime(done ? t.closed_at ?? t.updated_at : t.arrive_at)}</span>
              </span>
              <span className="block truncate text-small font-semibold text-ink-2">{t.direction === 'pickup' ? 'Pickup' : 'Drop-off'} · {relationName(t)}{c?.className ? ` · ${c.className}` : ''}</span>
              <span className="mt-1.5 flex flex-wrap gap-1.5">
                {t.status === 'handed_over' && <Pill tone="live" icon={<House />}>Handed over</Pill>}
                {t.status === 'checked_in' && <Pill tone="live" icon={<School />}>Checked in</Pill>}
                {t.status === 'cancelled' && <Pill tone="stale">Cancelled</Pill>}
                {!done && isLate(t) && <Pill tone="warning" icon={<Timer />}>Running late · {clockTime(t.arrive_at)}</Pill>}
                {!done && t.off_schedule && !isLate(t) && <Pill tone="warning" icon={<TriangleAlert />}>{t.reason ?? 'Outside the usual time'}</Pill>}
                {!done && t.arrived_at && <Pill tone="danger" icon={<MapPin />}>At the gate</Pill>}
                {!done && t.ready_at && <Pill tone="live" icon={<CircleCheck />}>Ready</Pill>}
                {!done && t.acknowledged_at && !t.ready_at && <Pill icon={<Eye />}>Seen</Pill>}
                {!done && t.traveller_kind === 'third_person' && (t.direction === 'dropoff' ? <Pill icon={<Link2 />}>Sent by a parent</Pill>
                  : locked.has(t.id) ? <Pill tone="danger" icon={<Lock />}>Locked</Pill> : <Pill icon={<KeyRound />}>Code needed</Pill>)}
                {!done && t.phoned_in_by && <Pill icon={<Headset />}>Phoned in</Pill>}
                {!done && !mine && (c && !covered.has(c.classId) ? <Pill tone="warning" icon={<BellRing />}>{gate.data!.assigned.some((x) => x.classId === c.classId) ? 'Nobody on duty' : 'Nobody assigned'}</Pill> : <Pill icon={<BellRing />}>Other class</Pill>)}
              </span>
            </span>
          </button>
          {n ? <Button size="md" variant={n.step === 'acknowledge' ? 'sunshine' : 'primary'} icon={n.icon} loading={busy === t.id} onClick={() => doNext(t)}>{n.label}</Button>
            : !done && <Pill icon={<UserCheck />}>{t.direction === 'pickup' ? 'Coordinator hands over' : 'Coordinator checks in'}</Pill>}
        </div>
      </li>
    )
  }

  const Section = ({ title, icon, list, empty }: { title: string; icon: ReactNode; list: Trip[]; empty?: string }) => (
    <section className="grid gap-2.5">
      <h2 className="kicker flex items-center gap-2 px-0.5 [&_svg]:size-4">{icon}{title} · {list.length}</h2>
      {list.length ? <ul className="grid gap-2.5">{list.map((t) => <Fragment key={t.id}>{Row({ t })}</Fragment>)}</ul>
        : empty ? <p className="rounded-lg bg-sunken px-4 py-3 text-small font-semibold text-ink-2">{empty}</p> : null}
    </section>
  )

  const detailChild = selected ? children.get(selected.child_id) : null

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
      <div className="grid gap-6">
        <div className="flex flex-wrap items-center gap-3">
          <Tabs id="scope" label="Whose children" value={scope} onChange={setScope}
            items={[{ key: 'mine', label: gate.data.myClasses.size ? 'Your classes' : 'Uncovered classes', icon: <BellRing /> }, { key: 'all', label: 'Whole school', icon: <School /> }]} />
          {canClose && <LuxButton size="sm" icon={<Phone />} className="ml-auto" disabled={!school.children} onClick={() => setCalling(true)}>Log a call</LuxButton>}
        </div>
        {settingsFailed && <Notice tone="warning" icon={<TriangleAlert aria-hidden />}>Using default announcement wording. Couldn't load school settings; trying again.</Notice>}
        {error && <Notice tone="danger">{error}</Notice>}
        {sections.attention.length > 0 && Section({ title: 'Needs attention', icon: <TriangleAlert />, list: sections.attention })}
        {Section({ title: 'Coming', icon: <Navigation />, list: sections.coming, empty: 'Nobody is on the way right now. New drop-offs and pickups appear here and are announced.' })}
        {sections.done.length > 0 && Section({ title: 'Done today', icon: <CircleCheck />, list: sections.done })}
        {school.children && <ClassRoster canClose={canClose} children={school.children.filter((c) => inScope(c.id))} onDone={() => { school.reload(); void trips.reload() }} />}
      </div>

      {/* The chosen trip, side by side on iPad landscape and desktop. */}
      <aside className="card sticky top-[calc(env(safe-area-inset-top)+180px)] hidden rounded-2xl p-6 lg:block" aria-label="Details">
        {selected && detailChild ? (
          <TripDetail canClose={canClose} trip={selected} child={detailChild} busy={busy === selected.id} locked={locked.has(selected.id)} onStep={(s) => (s === 'handover' ? openHandover(selected) : void act(selected, s))} />
        ) : (
          <div className="grid justify-items-center gap-2 py-8 text-center text-body text-ink-2">
            <School className="size-10 text-ink-3" aria-hidden />
            Choose someone in the queue to see the details.
          </div>
        )}
      </aside>

      <Sheet open={!!handover} onClose={() => setHandover(null)} title={handover ? `Hand over ${children.get(handover.child_id)?.name ?? ''}` : 'Hand over'}
        description="Only family the school has added. Anyone else needs a parent's link.">
        {handover && (
          <div className="grid gap-2.5">
            {(['parent', 'family'] as const).map((kind) => {
              const list = (children.get(handover.child_id)?.guardians ?? []).filter((g) => g.active && g.kind === kind)
              return list.length > 0 && (
                <div key={kind} className="grid gap-2.5">
                  <p className="kicker mt-1">{kind === 'parent' ? 'Parents' : 'Family'}</p>
                  {list.map((g) => (
                    <button key={g.id} type="button" className="choice flex items-center gap-3 p-3 text-left" disabled={busy === handover.id} onClick={() => void act(handover, 'close', g.id)}>
                      <Avatar name={g.name} color={kind === 'parent' ? 'var(--rb-blue)' : 'var(--ink-3)'} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-h4">{g.name}</span>
                        <span className="block text-small font-semibold text-ink-2">{g.relation}{g.abroad ? ', lives outside India' : ''}{g.id === handover.created_by ? ", said they're on the way" : ''}</span>
                      </span>
                      <UserCheck className="size-5 text-accent" aria-hidden />
                    </button>
                  ))}
                </div>
              )
            })}
            {error && <Notice tone="danger">{error}</Notice>}
            <Notice tone="warning">Someone not on this list? Don't hand over. Call the parent first.</Notice>
          </div>
        )}
      </Sheet>
      <div className="lg:hidden">
        <Sheet open={!!picked && !!selected && !!detailChild} onClose={() => setPicked(null)} title={detailChild?.fullName ?? 'Details'}>
          {selected && detailChild && <TripDetail canClose={canClose} trip={selected} child={detailChild} busy={busy === selected.id} locked={locked.has(selected.id)} onStep={(s) => { if (s === 'handover') { setPicked(null); openHandover(selected) } else void act(selected, s) }} />}
        </Sheet>
      </div>
      {calling && school.children && <CallSheet open onClose={() => setCalling(false)} children={school.children} nowMs={nowMs} onLogged={() => { school.reload(); void trips.reload() }} />}
      {codeFor && (
        <CodeSheet open onClose={() => setCodeFor(null)} trip={codeFor} childName={children.get(codeFor.child_id)?.name ?? 'the child'}
          onDone={(isLocked) => {
            if (isLocked) return setLocked((l) => new Set(l).add(codeFor.id))
            toast(`Code correct. ${children.get(codeFor.child_id)?.name ?? 'The child'} handed over to ${codeFor.traveller_name.split(' ')[0]}.`)
            setCodeFor(null)
            void trips.reload()
          }} />
      )}
      {(() => {
        // The request this phone is announcing that nobody has acknowledged yet, earliest first: popped up to acknowledge.
        // Not over another sheet the coordinator is using, and not while their duty is paused.
        if (paused || handover || codeFor || calling) return null
        const waiting = trips.trips!.filter((t) => {
          const c = children.get(t.child_id)
          const snoozed = later.get(t.id)
          return c && !(snoozed && snoozed.version === t.updated_at && nowMs < snoozed.until) && shouldAnnounce(t, c.classId, gate.data!.myClasses, covered, nowMs)
        }).sort((a, b) => Number(!!b.arrived_at) - Number(!!a.arrived_at) || Date.parse(a.arrive_at) - Date.parse(b.arrive_at))
        const t = waiting[0]
        const c = t && children.get(t.child_id)
        if (!t || !c) return null
        return <RequestPopup key={`${t.id}|${t.updated_at}`} trip={t} child={c} more={waiting.length - 1} busy={busy === t.id} error={errorTrip === t.id ? error : null}
          onAcknowledge={() => void act(t, 'acknowledge')} onLater={() => setLater((m) => new Map(m).set(t.id, { version: t.updated_at, until: Date.now() + cfg.reminder_min * 60_000 }))} />
      })()}
      <Button size="md" variant="quiet" icon={<RotateCcw />} className="justify-self-start lg:col-span-2" onClick={() => { void trips.reload(); void gate.reload() }}>Refresh</Button>
    </div>
  )
}

function TripDetail({ trip, child, busy, locked, canClose, onStep }: { trip: Trip; child: GateChild & { guardians: Guardian[] }; busy: boolean; locked: boolean; canClose: boolean; onStep: (s: GateStep | 'handover') => void }) {
  const third = trip.traveller_kind === 'third_person'
  const who = trip.traveller_name.split(' ')[0]!
  const done = trip.status !== 'en_route'
  const pickup = trip.direction === 'pickup'
  const fact = (label: string, value: string) => (
    <div className="rounded-lg bg-sunken px-3.5 py-2.5">
      <p className="kicker">{label}</p>
      <p className="mt-0.5 text-h4 tabular-nums">{value}</p>
    </div>
  )
  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-3.5">
        <Avatar name={child.name} color={childColor(child.id)} size="lg" />
        <div className="min-w-0">
          <p className="kicker">{pickup ? 'Pickup' : 'Drop-off'} · {clockTime(trip.arrive_at)}</p>
          <h3 className="truncate text-h2">{child.fullName}</h3>
          <p className="truncate text-small font-semibold text-ink-2">{child.programmeName ? classLabel(child.programmeName) : child.className}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        {fact('Arrives', `about ${clockTime(trip.arrive_at)}`)}
        {fact('Coming', relationName(trip) || trip.traveller_name)}
      </div>
      {third && !done && (pickup
        ? <Notice tone="info" icon={<KeyRound aria-hidden />}>Sent by a parent: {who} ({trip.traveller_relation?.toLowerCase() ?? 'not family'}) isn't registered with the school. Hand over only with the 4-digit code on {who}'s phone, and check their ID if you don't know them.</Notice>
        : <Notice tone="info" icon={<Link2 aria-hidden />}>Sent by a parent: {who} ({trip.traveller_relation?.toLowerCase() ?? 'not family'}) is bringing {child.name}. They aren't registered with the school; check {child.name} in as usual. No code is needed.</Notice>
      )}
      {isLate(trip) && !done && (
        <Notice tone="warning" icon={<Timer aria-hidden />}>
          <span className="grid gap-0.5">
            <b>Running late: now about {clockTime(trip.arrive_at)}{trip.late_from ? `, was ${clockTime(trip.late_from)}` : ''}.</b>
            {trip.late_note && <span>“{trip.late_note}”</span>}
          </span>
        </Notice>
      )}
      {trip.off_schedule && trip.reason && !isLate(trip) && <Notice tone="warning" icon={<TriangleAlert aria-hidden />}>Outside the usual time: {trip.reason}</Notice>}
      {done ? (
        <Notice tone="success">{trip.status === 'handed_over' ? `Handed over at ${clockTime(trip.closed_at!)}.` : trip.status === 'checked_in' ? `Checked in at ${clockTime(trip.closed_at!)}.` : 'Cancelled by the parent or the school.'}</Notice>
      ) : (
        <div className="grid gap-2.5">
          {(!trip.acknowledged_at || arrivedSinceSeen(trip)) && <Button variant={trip.off_schedule ? 'sunshine' : 'secondary'} icon={<Eye />} loading={busy} onClick={() => onStep('acknowledge')}>Acknowledge</Button>}
          {pickup && !trip.ready_at && <Button variant="secondary" icon={<CircleCheck />} loading={busy} onClick={() => onStep('ready')}>{child.name} is ready</Button>}
          {locked ? <Notice tone="danger" icon={<Lock aria-hidden />}>Locked after three wrong codes. Call the parent before releasing {child.name}.</Notice>
            : !canClose ? <Notice icon={<UserCheck aria-hidden />}>A center coordinator {pickup ? `hands ${child.name} over` : `checks ${child.name} in`} at the gate.</Notice>
            : pickup
            ? <LuxButton primary size="xl" icon={third ? <KeyRound /> : <UserCheck />} loading={busy} onClick={() => onStep('handover')}>{third ? `Enter ${who}'s code` : 'Hand over'}</LuxButton>
            : <LuxButton primary size="xl" icon={<DoorOpen />} loading={busy} onClick={() => onStep('close')}>Check in {child.name}</LuxButton>}
          {third && trip.traveller_phone && <a className="btn btn--quiet btn--md" href={`tel:${trip.traveller_phone}`}><Phone aria-hidden />Call {who}, {formatMobile(trip.traveller_phone)}</a>}
        </div>
      )}
    </div>
  )
}
