// DEVELOPMENT MOCK, never in a production build. `npm run dev:demo` answers every Supabase request in the browser with
// the made-up school below, so the screens can be checked without touching the live project. Nothing is saved: a
// reload starts over except for who is signed in. Loaded only when import.meta.env.DEV and VITE_DEMO=1 (supabase.ts).
import { checkPattern, DEFAULT_POLICY, generate, passwordProblem, RECOMMENDED, type Block, type Policy } from '../../supabase/functions/_shared/passwordPattern'
import { templateProblem, timingProblem, TEMPLATE_KEYS, type TemplateKey } from '../../supabase/functions/_shared/gateAnnounce'

interface Person {
  id: string; user_id: string; full_name: string; email: string | null; phone: string; roles: string[]
  email_sign_in: 'none' | 'temporary' | 'own'; password: string | null
  temp_password_expires_at?: string | null; locked_until?: string | null; failures?: number; history?: string[]
}

const people: Person[] = [
  { id: 'p-admin', user_id: 'u-admin', full_name: 'Anita Kapoor', email: 'anita.kapoor@jumpstart.test', phone: '+919800000001', roles: ['admin', 'core'], email_sign_in: 'own', password: 'AdminDemo#2026' },
  { id: 'p-parent', user_id: 'u-parent', full_name: 'Meera Shah', email: 'meera.shah@gmail.com', phone: '+919800000002', roles: [], email_sign_in: 'temporary', password: 'meerQK4827#', temp_password_expires_at: new Date(Date.now() + 48 * 3600_000).toISOString() },
  { id: 'p-dad', user_id: 'u-dad', full_name: 'Rohan Shah', email: 'rohan.shah92@outlook.com', phone: '+919800000003', roles: [], email_sign_in: 'none', password: null },
  { id: 'p-gran', user_id: 'u-gran', full_name: 'Sunita Rao', email: null, phone: '+919800000004', roles: [], email_sign_in: 'none', password: null },
  { id: 'p-lead', user_id: 'u-lead', full_name: 'Lata Joshi', email: 'lata.joshi@jumpstart.test', phone: '+919800000005', roles: ['leader'], email_sign_in: 'own', password: 'LeaderDemo#2026' },
  { id: 'p-coord', user_id: 'u-coord', full_name: 'Kiran Patil', email: 'kiran.patil@jumpstart.test', phone: '+919800000006', roles: ['coordinator'], email_sign_in: 'own', password: 'CoordDemo#2026' },
  { id: 'p-vikram', user_id: 'u-vikram', full_name: 'Vikram Mehta', email: null, phone: '+919800000007', roles: [], email_sign_in: 'none', password: null },
  { id: 'p-neha', user_id: 'u-neha', full_name: 'Neha Kapoor', email: null, phone: '+919800000008', roles: [], email_sign_in: 'none', password: null },
]
// Temporary passwords (D55, 0048): the rules and the patterns, with the same checks as the database.
let policy: Policy & { changed_at: string } = { ...DEFAULT_POLICY, changed_at: '2026-10-04T06:30:00Z' }
const patterns: Record<string, { scope: string; blocks: Block[]; changed_at: string }> = { default: { scope: 'default', blocks: RECOMMENDED, changed_at: '2026-10-04T06:30:00Z' } }
const patternFor = (p: Person) =>
  (['admin', 'core', 'leader', 'coordinator', 'pro'].map((r) => p.roles.includes(r) && patterns[r]).find(Boolean) || (!p.roles.length && patterns.family) || patterns.default!).blocks
const now = () => new Date().toISOString()

const programme = { id: 'g-nur', name: 'Nursery · Morning', class_id: 'c-nur', extended: false, flexible: false, starts: '09:00', ends: '12:30', weekdays: [1, 2, 3, 4, 5], saturday_rule: 'except_2nd_and_last', term_start: null, term_end: null, dropoff_from: '08:45', dropoff_to: '09:15', pickup_from: '12:15', pickup_to: '12:45' }
// Programmes of their own, to try a child in more than one programme (D56): Aarav also goes to After School.
const learningCenter = { ...programme, id: 'g-lc', name: 'Learning Center', class_id: 'c-lc', flexible: true, starts: '09:00', ends: '19:00', weekdays: [1, 2, 3, 4, 5, 6], dropoff_from: null, dropoff_to: null, pickup_from: null, pickup_to: null }
const afterSchool = { ...programme, id: 'g-as', name: 'After School Program', class_id: 'c-as', saturday_rule: 'every', starts: '16:00', ends: '19:00', dropoff_from: '15:45', dropoff_to: '16:00', pickup_from: '19:00', pickup_to: '19:15' }
const programmes = [programme, learningCenter, afterSchool]
let childProgrammes = [{ child_id: 'k-aarav', programme_id: 'g-as' }]
const classes = [{ id: 'c-pg', name: 'Playgroup', active: true, sort: 1 }, { id: 'c-nur', name: 'Nursery', active: true, sort: 2 }, { id: 'c-jr', name: 'Jr KG', active: true, sort: 3 }, { id: 'c-sr', name: 'Sr KG', active: true, sort: 4 },
  { id: 'c-lc', name: 'Learning Center', active: true, sort: 5 }, { id: 'c-as', name: 'After School Program', active: true, sort: 6 }]
const guardianships = [
  { child_id: 'k-aarav', guardian_id: 'p-parent', relation: 'Mother', kind: 'parent' },
  { child_id: 'k-aarav', guardian_id: 'p-dad', relation: 'Father', kind: 'parent' },
  { child_id: 'k-aarav', guardian_id: 'p-gran', relation: 'Grandmother', kind: 'family' },
  { child_id: 'k-kiara', guardian_id: 'p-vikram', relation: 'Father', kind: 'parent' },
  { child_id: 'k-rohan', guardian_id: 'p-neha', relation: 'Mother', kind: 'parent' },
]
const child = (over: Record<string, unknown>) => ({ class_id: 'c-nur', programme_id: 'g-nur', date_of_birth: '2022-04-12', active: true, gender: 'boy', preferred_name: null, programmes: programme, classes: { name: 'Nursery' }, child_schedules: [], ...over })
const children = [
  child({ id: 'k-aarav', full_name: 'Aarav Shah', guardianships: guardianships.filter((g) => g.child_id === 'k-aarav') }),
  child({ id: 'k-kiara', full_name: 'Kiara Mehta', gender: 'girl', guardianships: guardianships.filter((g) => g.child_id === 'k-kiara') }),
  child({ id: 'k-rohan', full_name: 'Rohan Kapoor', guardianships: guardianships.filter((g) => g.child_id === 'k-rohan') }),
]

// Today's trips, kept in this browser so every demo tab shares them: a parent's tab and a gate tab hear the same trip.
// Seeded relative to when the demo first opens: Aarav's mother 15 minutes away, Kiara's father dropping off in about 6,
// and a one-time driver for Rohan in 25 (a time not recorded ahead).
const TRIPS_KEY = 'jumpstart.demo.trips'
const todayIndia = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())
type DemoTrip = Record<string, unknown> & { id: string; child_id: string; direction: string; status: string }
function seedTrips(): DemoTrip[] {
  const now = Date.now()
  const at = (m: number) => new Date(now + m * 60_000).toISOString()
  const base = { day: todayIndia(), status: 'en_route', off_schedule: false, reason: null, created_at: at(0), updated_at: at(0), acknowledged_by: null, acknowledged_at: null, ready_at: null, closed_at: null, handed_to: null, arrived_at: null, traveller_kind: 'guardian', traveller_phone: null, sharing: false, handed_to_name: null }
  return [
    { ...base, id: 'trip-aarav', child_id: 'k-aarav', direction: 'pickup', arrive_at: at(15), created_by: 'p-parent', traveller_name: 'Meera Shah', traveller_relation: 'Mother' },
    { ...base, id: 'trip-kiara', child_id: 'k-kiara', direction: 'dropoff', arrive_at: at(6), created_by: 'p-vikram', traveller_name: 'Vikram Mehta', traveller_relation: 'Father' },
    { ...base, id: 'trip-rohan', child_id: 'k-rohan', direction: 'pickup', arrive_at: at(25), created_by: 'p-neha', traveller_name: 'Ramesh', traveller_relation: 'Driver', traveller_kind: 'third_person', traveller_phone: '+919811111111' },
  ]
}
function readTrips(): DemoTrip[] {
  try {
    const saved = JSON.parse(localStorage.getItem(TRIPS_KEY) ?? 'null') as DemoTrip[] | null
    if (saved && saved.every((t) => t.day === todayIndia())) return saved
  } catch { /* fresh start */ }
  const fresh = seedTrips()
  writeTrips(fresh)
  return fresh
}
function writeTrips(t: DemoTrip[]) {
  try { localStorage.setItem(TRIPS_KEY, JSON.stringify(t)) } catch { /* this tab only */ }
  // Every screen showing trips reloads on 'online' (useTodayTrips): stands in for the realtime message.
  setTimeout(() => window.dispatchEvent(new Event('online')), 0)
}
if (typeof window !== 'undefined') window.addEventListener('storage', (e) => { if (e.key === TRIPS_KEY) window.dispatchEvent(new Event('online')) })
/** Changes one trip as the database would, and returns it. */
/** The fields running_late sets (0043). */
const lateBy = (to: number, from: number, by: string | null, note: string | null): Partial<DemoTrip> => ({
  arrive_at: new Date(to).toISOString(), late_from: new Date(from).toISOString(), late_at: new Date().toISOString(), late_by: by,
  late_note: note?.trim() || null, acknowledged_at: null, acknowledged_by: null,
})
function changeTrip(id: unknown, patch: (t: DemoTrip) => Partial<DemoTrip>): DemoTrip | null {
  const all = readTrips()
  const t = all.find((x) => x.id === id)
  if (!t) return null
  Object.assign(t, patch(t), { updated_at: new Date().toISOString() })
  writeTrips(all)
  return t
}

const profileRow = (p: Person) => ({ id: p.id, full_name: p.full_name, email: p.email, phone: p.phone, active: true, app_access: true, abroad: false, user_id: p.user_id, invited_at: null, invited_via: null, email_sign_in: p.email_sign_in, temp_password_expires_at: p.temp_password_expires_at ?? null, locked_until: p.locked_until ?? null })

// Messages and announcements (0013), shared by every demo tab like the trips, so one tab's message pops up in another
// (D57). Seeded so the badges show at once: the school wrote to Aarav's family, Kiara's father wrote to the school, and
// there is one announcement nobody has read.
const TALK_KEY = 'jumpstart.demo.talk'
interface DemoMsg { id: number; child_id: string; sender: string; sender_name: string; sender_role: string; body: string; created_at: string }
interface DemoAnn { id: string; title: string; body: string; class_id: string | null; sent_by: string; sender_name: string; sender_role: string; created_at: string }
interface Talk { messages: DemoMsg[]; reads: Record<string, Record<string, string>>; announcements: DemoAnn[]; annReads: Record<string, string[]> }
function seedTalk(): Talk {
  const ago = (m: number) => new Date(Date.now() - m * 60_000).toISOString()
  return {
    messages: [
      { id: 1, child_id: 'k-aarav', sender: 'p-lead', sender_name: 'Lata Joshi', sender_role: 'core', body: 'Aarav painted a lovely sunflower today. Please send an old T-shirt for art tomorrow.', created_at: ago(40) },
      { id: 2, child_id: 'k-kiara', sender: 'p-vikram', sender_name: 'Vikram Mehta', sender_role: 'parent', body: 'Kiara has a mild cold. Please keep her inside at play time.', created_at: ago(25) },
    ],
    reads: {},
    announcements: [{ id: 'ann-1', title: 'Sports day on Friday', body: 'Children can come in sports clothes. Parents are welcome from 10 AM.', class_id: null, sent_by: 'p-admin', sender_name: 'Anita Kapoor', sender_role: 'admin', created_at: ago(90) }],
    annReads: {},
  }
}
function readTalk(): Talk {
  try { const t = JSON.parse(localStorage.getItem(TALK_KEY) ?? 'null') as Talk | null; if (t?.messages) return t } catch { /* fresh start */ }
  const t = seedTalk()
  writeTalk(t, false)
  return t
}
/** Saves, then tells every screen to look again (stands in for the realtime message the real database sends). */
function writeTalk(t: Talk, nudge = true) {
  try { localStorage.setItem(TALK_KEY, JSON.stringify(t)) } catch { /* this tab only */ }
  if (nudge) setTimeout(() => document.dispatchEvent(new Event('visibilitychange')), 0)
}
if (typeof window !== 'undefined') window.addEventListener('storage', (e) => { if (e.key === TALK_KEY) document.dispatchEvent(new Event('visibilitychange')) })
const OFFICE_ROLE = (p: Person) => (p.roles.includes('core') || p.roles.includes('leader') ? 'core' : p.roles.includes('pro') ? 'pro' : 'admin')
function sendDemoMessage(childId: string, who: Person, body: string): DemoMsg {
  const t = readTalk()
  const g = guardianships.find((x) => x.child_id === childId && x.guardian_id === who.id)
  const m = { id: Math.max(0, ...t.messages.map((x) => x.id)) + 1, child_id: childId, sender: who.id, sender_name: who.full_name, sender_role: g ? g.kind : OFFICE_ROLE(who), body, created_at: new Date().toISOString() }
  t.messages.push(m)
  ;(t.reads[who.id] ??= {})[childId] = m.created_at
  writeTalk(t)
  return m
}
function sendDemoAnnouncement(title: string, body: string, who: Person | undefined) {
  const t = readTalk()
  const a = { id: `ann-${Date.now()}`, title, body, class_id: null, sent_by: who?.id ?? 'p-admin', sender_name: who?.full_name ?? 'Anita Kapoor', sender_role: who ? OFFICE_ROLE(who) : 'admin', created_at: new Date().toISOString() }
  t.announcements.unshift(a)
  writeTalk(t)
  return a
}

// Gate announcements (0042): null wording means the default, like the real table.
let gate: Record<string, unknown> = { id: true, early_min: 15, ready_min: 10, urgent_min: 5, reminder_min: 2, updated_at: '2026-10-03T06:30:00Z' }

const TABLES: Record<string, () => unknown[]> = {
  gate_announcement_settings: () => [gate],
  trips: () => readTrips(),
  coordinator_classes: () => [{ profile_id: 'p-lead', class_id: 'c-nur' }, { profile_id: 'p-coord', class_id: 'c-nur' }],
  profiles: () => people.map(profileRow),
  staff_roles: () => people.flatMap((p) => p.roles.map((role) => ({ profile_id: p.id, role }))),
  // Each child with their other programmes embedded, as PostgREST returns child_programmes(programmes(...)).
  children: () => children.map((c: Record<string, unknown>) => ({ ...c, child_programmes: childProgrammes.filter((x) => x.child_id === c.id).map((x) => ({ programmes: programmes.find((p) => p.id === x.programme_id) ?? null })) })),
  child_programmes: () => childProgrammes,
  guardianships: () => guardianships,
  classes: () => classes,
  programmes: () => programmes,
  settings: () => [{ id: true, get_ready_lead_min: 10, late_threshold_min: 10, school_phone: '+912025451234', app_url: 'http://localhost:5173' }],
  password_policy: () => [policy],
  password_patterns: () => Object.values(patterns),
}

// The signed-in person rides in the access token's subject, like the real thing.
const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
function session(p: Person, method: 'password' | 'otp') {
  const exp = Math.floor(Date.now() / 1000) + 3600
  const user = { id: p.user_id, aud: 'authenticated', role: 'authenticated', email: p.email ?? undefined, phone: p.phone.slice(1), app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' }
  return { access_token: `${b64({ alg: 'none' })}.${b64({ sub: p.user_id, role: 'authenticated', exp, amr: [{ method, timestamp: exp - 3600 }] })}.demo`, refresh_token: `demo-${p.user_id}-${method}`, token_type: 'bearer', expires_in: 3600, expires_at: exp, user }
}
function caller(headers: Headers): Person | null {
  const token = (headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  try {
    const { sub } = JSON.parse(atob((token.split('.')[1] ?? '').replace(/-/g, '+').replace(/_/g, '/'))) as { sub?: string }
    return people.find((p) => p.user_id === sub) ?? null
  } catch { return null }
}

const json = (body: unknown, status = 200) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const authError = (code: string, message: string, status = 400) => json({ code, error_code: code, msg: message, message }, status)

export async function demoFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  banner()
  const req = new Request(input, init)
  const url = new URL(req.url)
  const path = url.pathname
  const body = req.method === 'GET' || req.method === 'HEAD' ? null : await req.clone().json().catch(() => null) as Record<string, unknown> | null
  const me = caller(req.headers)
  await new Promise((r) => setTimeout(r, 250)) // A little latency, so loading states show.

  // Sign-in
  if (path.endsWith('/auth/v1/token')) {
    const grant = url.searchParams.get('grant_type')
    if (grant === 'password') {
      const p = people.find((x) => x.email && x.email === String(body?.email ?? '').toLowerCase())
      if (!p || !p.password || p.password !== body?.password) return authError('invalid_credentials', 'Invalid login credentials')
      // What the Custom Access Token hook refuses (0048).
      // Locked or off answers exactly like a wrong password.
      if (p.email_sign_in === 'none' || (p.locked_until ?? '') > now()) return authError('invalid_credentials', 'Invalid login credentials')
      if (p.email_sign_in === 'temporary' && (p.temp_password_expires_at ?? '') <= now()) return authError('unexpected_failure', 'temporary_expired: This temporary password has expired.', 403)
      return json(session(p, 'password'))
    }
    if (grant === 'refresh_token') {
      const [, uid, method] = /^demo-(u-[a-z]+)-(password|otp)$/.exec(String(body?.refresh_token ?? '')) ?? []
      const p = people.find((x) => x.user_id === uid)
      return p ? json(session(p, method === 'password' ? 'password' : 'otp')) : authError('refresh_token_not_found', 'Invalid Refresh Token', 400)
    }
  }
  if (path.endsWith('/auth/v1/otp')) return json({})
  if (path.endsWith('/auth/v1/verify')) {
    const p = people.find((x) => x.phone === `+${String(body?.phone ?? '').replace(/^\+/, '')}`)
    if (!p || body?.token !== '123456') return authError('otp_expired', 'Token has expired or is invalid', 403)
    return json(session(p, 'otp'))
  }
  if (path.endsWith('/auth/v1/user')) {
    if (!me) return authError('session_not_found', 'not signed in', 401)
    if (req.method === 'PUT' && typeof body?.password === 'string') {
      if (body.password === me.password) return authError('same_password', 'New password should be different from the old password.', 422)
      me.password = body.password
      me.email_sign_in = 'own'
    }
    return json(session(me, 'password').user)
  }
  if (path.endsWith('/auth/v1/logout')) return new Response(null, { status: 204 })

  // The password-pattern function: one temporary password, shown once (D55).
  if (path.endsWith('/functions/v1/password-pattern')) {
    if (!me?.roles.includes('admin')) return json({ error: 'Only the admin can issue temporary passwords.' }, 403)
    const p = people.find((x) => x.id === body?.profile_id)
    if (!p) return json({ error: 'Turn on app access for them first.' }, 400)
    if (p.id === me.id) return json({ error: "You can't issue your own temporary password. Ask the other admin." }, 400)
    if (!p.email) return json({ error: 'Add their email first.' }, 400)
    const blocks = patternFor(p)
    const problem = checkPattern(blocks, policy).problem
    if (problem) return json({ error: `${problem} Fix the pattern in Settings first.` }, 400)
    if (p.password) p.history = [p.password, ...(p.history ?? [])].slice(0, 24)
    p.password = generate(blocks, { full_name: p.full_name, email: p.email })
    p.email_sign_in = 'temporary'
    p.temp_password_expires_at = new Date(Date.now() + policy.temp_expiry_hours * 3600_000).toISOString()
    p.locked_until = null
    p.failures = 0
    return json({ password: p.password, expires_at: p.temp_password_expires_at })
  }
  // The password-change function: their own password, under the rules and not a recent one.
  if (path.endsWith('/functions/v1/password-change')) {
    if (!me) return json({ error: 'Please sign in again.' }, 401)
    if (me.email_sign_in === 'none') return json({ error: "Email sign-in isn't turned on for you. Ask the school." }, 403)
    const pw = String(body?.password ?? '')
    const problem = passwordProblem(pw, policy)
    if (problem) return json({ error: problem }, 400)
    if (pw === me.password || (me.history ?? []).slice(0, policy.reuse_count).includes(pw)) return json({ error: 'You used this password recently. Choose a different one.' }, 400)
    if (me.password) me.history = [me.password, ...(me.history ?? [])].slice(0, 24)
    me.password = pw
    me.email_sign_in = 'own'
    me.temp_password_expires_at = null
    return json({ ok: true })
  }
  if (path.includes('/functions/v1/')) return json({ error: 'Not part of the demo.' }, 404)

  // Database functions
  const rpc = /\/rest\/v1\/rpc\/([a-z_]+)$/.exec(path)?.[1]
  if (rpc) {
    if (rpc === 'whoami') {
      if (!me) return json(null)
      const kids = guardianships.filter((g) => g.guardian_id === me.id).length
      return json({ profile_id: me.id, full_name: me.full_name, phone: me.phone, email: me.email, email_sign_in: me.email_sign_in, temp_password_expires_at: me.temp_password_expires_at ?? null, active: true, consent_version: '2026-10-02', roles: me.roles, children: kids })
    }
    if (rpc === 'phone_login_allowed') return json(true)
    // Wrong passwords and the lock (0048): says nothing back.
    if (rpc === 'password_sign_in_failed') {
      const p = people.find((x) => x.email && x.email === String(body?.p_email ?? '').toLowerCase())
      if (p && (p.locked_until ?? '') <= now() && (p.failures = (p.failures ?? 0) + 1) >= policy.max_failed) { p.locked_until = new Date(Date.now() + policy.lock_minutes * 60_000).toISOString(); p.failures = 0 }
      return json(null)
    }
    if (rpc === 'password_sign_in_ok') { if (me) me.failures = 0; return json(null) }
    if (rpc === 'admin_save_password_policy' || rpc === 'admin_save_password_pattern' || rpc === 'admin_email_sign_in_off') {
      if (!me?.roles.includes('admin')) return json({ code: '42501', message: 'Only the admin can do that.' }, 403)
      if (rpc === 'admin_email_sign_in_off') {
        const p = people.find((x) => x.id === body?.p_profile)
        if (!p || p.id === me.id) return json({ code: 'P0001', message: "self: You can't turn off your own email sign-in here." }, 400)
        Object.assign(p, { email_sign_in: 'none', password: null, temp_password_expires_at: null, locked_until: null })
        return json(null)
      }
      if (rpc === 'admin_save_password_policy') {
        const next = { ...policy, ...(body?.p as Partial<Policy>) }
        const bad = Object.values(patterns).find((x) => checkPattern(x.blocks, next).problem)
        if (bad) return json({ code: 'P0001', message: `weak_pattern: The ${bad.scope} pattern: ${checkPattern(bad.blocks, next).problem} Change the pattern first.` }, 400)
        policy = { ...next, changed_at: now() }
        return json(null)
      }
      const scope = String(body?.p_scope)
      const blocks = body?.p_blocks as Block[] | null
      if (!blocks) { if (scope !== 'default') delete patterns[scope]; return json(null) }
      const problem = checkPattern(blocks, policy).problem
      if (problem) return json({ code: 'P0001', message: `weak_pattern: ${problem}` }, 400)
      patterns[scope] = { scope, blocks, changed_at: now() }
      return json(null)
    }
    // Trips, as the database functions do them (0006, 0026, 0035, 0038).
    if (rpc === 'gate_step') {
      const now = new Date().toISOString()
      const step = body?.p_step
      return json(changeTrip(body?.p_trip, () => step === 'acknowledge' ? { acknowledged_at: now, acknowledged_by: me?.id }
        : step === 'ready' ? { ready_at: now, acknowledged_at: now, acknowledged_by: me?.id }
        : { status: 'handed_over', closed_at: now, handed_to: body?.p_handed_to ?? null }))
    }
    // Running late (0043): +5/+10/+15 or a later time, an optional note; the same checks as the database, in short.
    if (rpc === 'running_late') {
      const t = readTrips().find((x) => x.id === body?.p_trip)
      if (!t || t.status !== 'en_route') return json({ code: 'P0001', message: 'trip_closed: This trip has already finished.' }, 400)
      if (t.arrived_at) return json({ code: 'P0001', message: "already_here: You've already told the school you've arrived." }, 400)
      const from = Date.parse(String(t.arrive_at))
      const to = body?.p_minutes ? Math.max(from, Date.now()) + Number(body.p_minutes) * 60_000 : Date.parse(String(body?.p_at))
      if (!(to > from && to > Date.now())) return json({ code: 'P0001', message: 'not_later: Choose a later time.' }, 400)
      return json(changeTrip(t.id, () => lateBy(to, from, me?.id ?? null, (body?.p_note as string | null) ?? null)))
    }
    if (rpc === 'arrive_trip') return json(changeTrip(body?.p_trip, () => ({ arrived_at: new Date().toISOString() })))
    if (rpc === 'cancel_trip') return json(changeTrip(body?.p_trip, () => ({ status: 'cancelled', closed_at: new Date().toISOString() })))
    if (rpc === 'start_trip') {
      const arrive = new Date(Date.now() + Number(body?.p_minutes ?? 10) * 60_000).toISOString()
      const open = readTrips().find((t) => t.child_id === body?.p_child && t.direction === body?.p_direction && t.status === 'en_route')
      // A new time for a trip already on its way (running late, change time) replaces it, unacknowledged again.
      if (open) return json(changeTrip(open.id, () => ({ arrive_at: arrive, acknowledged_at: null, acknowledged_by: null, arrived_at: null, reason: body?.p_reason ?? null })))
      const all = readTrips()
      const t = { ...seedTrips()[0]!, id: `trip-${Date.now()}`, child_id: String(body?.p_child), direction: String(body?.p_direction), arrive_at: arrive, created_by: me?.id ?? 'p-parent', traveller_name: me?.full_name ?? 'Parent', traveller_relation: guardianships.find((g) => g.child_id === body?.p_child && g.guardian_id === me?.id)?.relation ?? null, reason: body?.p_reason ?? null }
      all.push(t)
      writeTrips(all)
      return json(t)
    }
    // Bulk upload (0022): the child and their family join the made-up school until a reload. Same mobile, same person.
    if (rpc === 'import_child') {
      const c = (body?.p_child ?? {}) as Record<string, unknown>
      if (children.some((k: Record<string, unknown>) => String(k.full_name).toLowerCase() === String(c.full_name).toLowerCase() && k.date_of_birth === c.date_of_birth)) {
        return json({ code: 'P0001', message: `duplicate: ${String(c.full_name)} is already registered.` }, 400)
      }
      const id = `k-${crypto.randomUUID().slice(0, 8)}`
      const links = ((body?.p_people ?? []) as Array<Record<string, string>>).map((x) => {
        let who = people.find((q) => q.phone === x.phone)
        if (!who) {
          who = { id: `p-${crypto.randomUUID().slice(0, 8)}`, user_id: '', full_name: x.full_name!, email: null, phone: x.phone!, roles: [], email_sign_in: 'none', password: null }
          people.push(who)
        }
        return { child_id: id, guardian_id: who.id, relation: x.relation!, kind: x.kind! }
      })
      guardianships.push(...links)
      children.push(child({ id, full_name: String(c.full_name), preferred_name: c.preferred_name ?? null, date_of_birth: c.date_of_birth ?? null, gender: c.gender ?? null, guardianships: links }))
      return json(id)
    }
    // Several programmes per child (0053): the main one gives the class; the others are programmes of their own.
    if (rpc === 'admin_set_programmes' || rpc === 'admin_save_child') {
      if (!me?.roles.includes('admin')) return json({ code: '42501', message: "Only the admin can change a child's programmes." }, 403)
      let kid = String(body?.p_child ?? '')
      let main = String(body?.p_main ?? '')
      let also = (body?.p_also ?? []) as string[]
      if (rpc === 'admin_save_child') {
        const c = (body?.p_child ?? {}) as Record<string, unknown>
        kid = `k-${crypto.randomUUID().slice(0, 8)}`
        main = String(c.programme_id ?? '')
        also = (c.also ?? []) as string[]
        const links = ((body?.p_people ?? []) as Array<Record<string, string>>).map((x) => {
          let who = people.find((q) => q.id === x.id || (x.phone && q.phone === x.phone))
          if (!who) {
            who = { id: `p-${crypto.randomUUID().slice(0, 8)}`, user_id: '', full_name: x.full_name!, email: null, phone: x.phone ?? '', roles: [], email_sign_in: 'none', password: null }
            people.push(who)
          }
          return { child_id: kid, guardian_id: who.id, relation: x.relation!, kind: x.kind ?? 'parent' }
        })
        guardianships.push(...links)
        children.push(child({ id: kid, full_name: String(c.full_name), preferred_name: c.preferred_name || null, date_of_birth: c.date_of_birth ?? null, gender: c.gender ?? null, guardianships: links }))
      }
      const k = children.find((c: Record<string, unknown>) => c.id === kid) as Record<string, unknown> | undefined
      const p = programmes.find((x) => x.id === main)
      if (!k || !p) return json({ code: 'P0001', message: 'programme_required: Choose the class and programme.' }, 400)
      if (also.some((id) => programmes.find((x) => x.id === id)?.name.includes(' · '))) return json({ code: 'P0001', message: 'one_class: A child is in one class programme. Make it the main programme instead.' }, 400)
      Object.assign(k, { programme_id: p.id, class_id: p.class_id, programmes: p, classes: { name: classes.find((c) => c.id === p.class_id)?.name } })
      childProgrammes = [...childProgrammes.filter((x) => x.child_id !== kid), ...[...new Set(also)].filter((id) => id !== main).map((id) => ({ child_id: kid, programme_id: id }))]
      return json(rpc === 'admin_save_child' ? kid : null)
    }
    if (rpc === 'send_message') {
      if (!me) return json({ code: '42501', message: 'Sign in first.' }, 401)
      return json(sendDemoMessage(String(body?.p_child), me, String(body?.p_body ?? '').trim()))
    }
    if (rpc === 'mark_read') {
      if (me) { const t = readTalk(); (t.reads[me.id] ??= {})[String(body?.p_child)] = new Date().toISOString(); writeTalk(t, false) }
      return json(null)
    }
    if (rpc === 'send_announcement') return json(sendDemoAnnouncement(String(body?.p_title ?? ''), String(body?.p_body ?? ''), me ?? undefined))
    if (rpc === 'mark_announcement_read') {
      if (me) { const t = readTalk(); const r = (t.annReads[me.id] ??= []); if (!r.includes(String(body?.p_announcement))) r.push(String(body?.p_announcement)); writeTalk(t, false) }
      return json(null)
    }
    if (rpc === 'announcement_stats') return json(readTalk().announcements.map((a) => ({ announcement_id: a.id, recipients: 6, reads: Object.values(readTalk().annReads).filter((r) => r.includes(a.id)).length })))
    if (rpc === 'recipient_count') return json(6)
    // Attendance & Reports (0062, 0064): the made-up month from the reports' test fixture, for the requested range. Demo only.
    if (rpc === 'attendance_report') {
      if (!me?.roles.some((r) => r === 'admin' || r === 'core' || r === 'leader' || r === 'coordinator')) return json({ code: '42501', message: 'Only school staff can see attendance reports.' }, 403)
      const { sampleReport } = await import('../features/reports/exports/fixture')
      const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)
      const to = String(body?.p_to) > today ? today : String(body?.p_to)
      const r = sampleReport({ from: String(body?.p_from), to, children: 30 })
      return json({ ...r, generated_at: new Date().toISOString(), to: String(body?.p_to), cutoff: to, today })
    }
    if (rpc === 'log_report_export') return json({ report_id: `DEMO-${Date.now().toString(36).toUpperCase()}`, generated_at: new Date().toISOString() })
    if (rpc === 'correct_attendance') return json(null)
    // Duty (0061), kept across reloads like the real server, with its version check.
    if (rpc === 'my_duty') return json(readDemoDuty())
    if (rpc === 'set_duty') {
      const cur = readDemoDuty() as { status: string; version: number } | null
      const next = String(body?.p_status)
      if ((cur?.status ?? 'off') === next) return json(cur)
      if ((body?.p_version ?? null) !== (cur?.version ?? null)) return json({ code: 'P0001', message: 'duty_conflict: Your duty was changed on another device.' }, 400)
      const at = new Date().toISOString()
      const d = next === 'off' ? null : cur
        ? { ...cur, status: next, version: cur.version + 1, changed_at: at, change_reason: body?.p_reason ?? null, [next === 'paused' ? 'paused_at' : 'resumed_at']: at }
        : { status: 'active', version: 1, started_at: at, changed_at: at, change_reason: 'started', paused_at: null, resumed_at: null }
      try { localStorage.setItem('jumpstart.demoDuty', JSON.stringify(d)) } catch { /* demo only */ }
      return json(d)
    }
    if (rpc === 'admin_save_gate_announcements') {
      if (!me?.roles.includes('admin')) return json({ code: '42501', message: 'Only the admin can change gate announcements.' }, 403)
      const p = (body?.p ?? {}) as Record<string, unknown>
      for (const k of TEMPLATE_KEYS) if (typeof p[k] === 'string' && templateProblem(k as TemplateKey, p[k] as string)) return json({ code: 'P0001', message: `bad_template: ${templateProblem(k as TemplateKey, p[k] as string)}` }, 400)
      const t = { early_min: Number(p.early_min ?? 15), ready_min: Number(p.ready_min ?? 10), urgent_min: Number(p.urgent_min ?? 5), reminder_min: Number(p.reminder_min ?? 2) }
      if (timingProblem(t)) return json({ code: 'P0001', message: `bad_timing: ${timingProblem(t)}` }, 400)
      gate = { ...p, ...t, id: true, updated_at: new Date().toISOString() }
      return json(gate)
    }
    return json(null)
  }

  // Tables: reads answer from the made-up school; writes succeed without changing anything.
  const table = /\/rest\/v1\/([a-z_]+)$/.exec(path)?.[1]
  if (table) {
    if (req.method !== 'GET') return json(null)
    // The conversation tables answer per person and per child, as row-level security and the query's filter would.
    const talk = ['messages', 'message_reads', 'announcements', 'announcement_reads'].includes(table) ? readTalk() : null
    const childEq = url.searchParams.get('child_id')?.replace(/^eq\./, '')
    const rows = table === 'messages' ? talk!.messages.filter((m) => !childEq || m.child_id === childEq).sort((x, y) => (url.searchParams.get('order')?.includes('desc') ? y.created_at.localeCompare(x.created_at) : x.created_at.localeCompare(y.created_at)))
      : table === 'message_reads' ? Object.entries(talk!.reads[me?.id ?? ''] ?? {}).map(([child_id, read_at]) => ({ profile_id: me?.id, child_id, read_at }))
      : table === 'announcements' ? talk!.announcements
      : table === 'announcement_reads' ? (talk!.annReads[me?.id ?? ''] ?? []).map((announcement_id) => ({ announcement_id, profile_id: me?.id }))
      // Children as row-level security and the query's filter allow: a parent sees only their own, never another family's.
      : table === 'children' ? (TABLES.children!() as Array<Record<string, unknown>>).filter((c) => {
          const mineOnly = url.searchParams.get('guardianships.guardian_id')?.replace(/^eq\./, '') ?? (me && !me.roles.length ? me.id : null)
          return !mineOnly || guardianships.some((g) => g.child_id === c.id && g.guardian_id === mineOnly)
        })
      : TABLES[table]?.() ?? []
    const one = (req.headers.get('Accept') ?? '').includes('vnd.pgrst.object')
    return one ? (rows[0] ? json(rows[0]) : json({ code: 'PGRST116', message: 'no rows' }, 406)) : json(rows)
  }
  return json({})
}

function readDemoDuty(): unknown {
  try { return JSON.parse(localStorage.getItem('jumpstart.demoDuty') ?? 'null') } catch { return null }
}

let shown = false
function banner() {
  if (shown || typeof document === 'undefined') return
  shown = true
  const el = document.createElement('div')
  el.textContent = 'Demo · made-up data'
  el.setAttribute('role', 'status')
  el.style.cssText = 'position:fixed;right:8px;top:calc(env(safe-area-inset-top) + 4px);z-index:60;white-space:nowrap;padding:4px 10px;border-radius:999px;background:#16193a;color:#e9c27a;font:700 11px/1.4 system-ui,sans-serif;letter-spacing:.04em;box-shadow:0 8px 20px -10px rgb(0 0 0/.6);pointer-events:none'
  document.body.append(el)
  document.body.append(controls())
}

/** The parent's side, for trying the gate: taps that change the shared trips, heard on any demo tab on duty. */
function controls(): HTMLElement {
  const box = document.createElement('details')
  box.style.cssText = 'position:fixed;left:8px;bottom:max(8px,env(safe-area-inset-bottom));z-index:60;max-width:min(320px,calc(100vw - 16px));border-radius:16px;background:#16193a;color:#f6f3ff;font:600 13px/1.35 system-ui,sans-serif;box-shadow:0 14px 30px -14px rgb(0 0 0/.7);'
  const summary = document.createElement('summary')
  summary.textContent = 'Demo: act as a parent'
  summary.style.cssText = 'cursor:pointer;padding:10px 14px;color:#e9c27a;font-weight:800;list-style:none'
  box.append(summary)
  const list = document.createElement('div')
  list.style.cssText = 'display:grid;gap:6px;padding:0 10px 10px'
  const later = (m: number) => (t: DemoTrip) => { const from = Date.parse(String(t.arrive_at)); return lateBy(Math.max(from, Date.now()) + m * 60_000, from, 'p-parent', 'Traffic near school') }
  const actions: Array<[string, () => void]> = [
    ["Aarav's mother taps I've arrived", () => void changeTrip('trip-aarav', () => ({ arrived_at: new Date().toISOString() }))],
    ["Aarav's mother is running late (+10 min)", () => void changeTrip('trip-aarav', later(10))],
    ["Kiara's father taps I've arrived", () => void changeTrip('trip-kiara', () => ({ arrived_at: new Date().toISOString() }))],
    ["Cancel Rohan's pickup", () => void changeTrip('trip-rohan', () => ({ status: 'cancelled', closed_at: new Date().toISOString() }))],
    ['Start all three trips again', () => writeTrips(seedTrips())],
    ['The school messages Aarav\'s family', () => void sendDemoMessage('k-aarav', people.find((p) => p.id === 'p-lead')!, 'Please pack a raincoat for Aarav tomorrow.')],
    ["Aarav's mother messages the school", () => void sendDemoMessage('k-aarav', people.find((p) => p.id === 'p-parent')!, 'Aarav will be picked up by his grandmother today.')],
    ['The school sends an announcement', () => void sendDemoAnnouncement('Holiday on Monday', 'The school is closed on Monday for Diwali. See you on Tuesday!', undefined)],
    ['Reset messages and announcements', () => writeTalk(seedTalk())],
  ]
  for (const [label, run] of actions) {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = label
    b.style.cssText = 'min-height:40px;padding:8px 12px;border-radius:10px;text-align:left;background:rgb(255 255 255/.08);color:inherit;box-shadow:inset 0 0 0 1px rgb(233 194 122/.3);cursor:pointer'
    b.addEventListener('click', run)
    list.append(b)
  }
  box.append(list)
  return box
}
