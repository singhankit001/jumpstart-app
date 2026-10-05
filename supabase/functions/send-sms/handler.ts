// Supabase Auth's "Send SMS" hook: Supabase makes and checks the 6-digit code, this sends it on WhatsApp. Kept free of
// Deno and npm imports so it can be tested; index.ts wires in the signature check, the database and WATI.
import type { Wati, WatiFailure, WhatsAppLogRow } from '../_shared/wati.ts'

export interface Deps {
  /** Checks the Standard Webhooks signature and returns the hook's payload, or throws when it is not genuine. */
  verify(rawBody: string, headers: Record<string, string>): unknown
  /** public.otp_recipient: the profile that may sign in with this number, or null. */
  otpRecipient(phone: string): Promise<string | null>
  /** public.otp_send_allowed: counts this send against the number's hourly limit; false once it is used up. */
  sendAllowed(phone: string): Promise<boolean>
  /** public.otp_send_refund: gives the place back when WATI didn't send the code, so its problems never lock anyone out. */
  sendRefund(phone: string): Promise<void>
  wati: Pick<Wati, 'sendTemplate'>
  /** Adds the delivery log row before WATI is called, so WATI's status webhook always finds it. Never given the code. */
  log(row: WhatsAppLogRow): Promise<void>
  /** Records WATI's answer on that row: the broadcast id, or the failure category. */
  logDone(localId: string, broadcastId: string | null, error: string | null): Promise<void>
  /** The sign-in code template's name on WATI. */
  template: string
  /** Makes the id WATI reports back on; crypto.randomUUID in production. */
  newId?: () => string
  /**
   * Keeps work going after the answer is sent (EdgeRuntime.waitUntil in production). Auth throws the code away if the
   * hook takes over 5 seconds, even when WATI has already delivered it, so nothing after the send holds up the answer.
   * Without it, the work is finished first.
   */
  after?: (work: Promise<unknown>) => void
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const BUSY: ReadonlySet<WatiFailure> = new Set(['rate_limited', 'unavailable', 'timeout'])

/**
 * POST from Supabase Auth { user: { phone }, sms: { otp } }. A number nobody registered gets the same empty 200 as a
 * sent code and costs nothing, so the answer never shows who is registered. A failed send answers with the hook's error
 * envelope, which Auth shows the person as "couldn't send".
 */
export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405)
  const raw = await req.text()
  let payload: { user?: { phone?: unknown }; sms?: { otp?: unknown } }
  try {
    payload = deps.verify(raw, Object.fromEntries(req.headers.entries())) as typeof payload
  } catch {
    return json({ error: 'unauthorized' }, 401)
  }
  const phone = payload?.user?.phone
  const otp = payload?.sms?.otp
  if (typeof phone !== 'string' || typeof otp !== 'string' || !otp) return json({ error: 'bad_request' }, 400)

  const unavailable = (code: 429 | 500 | 503) =>
    json({ error: { http_code: code, message: code === 429 ? 'rate_limited: Too many attempts. Please wait a moment and try again.' : "Couldn't send the WhatsApp code right now." } })

  let profileId: string | null
  try {
    profileId = await deps.otpRecipient(phone)
  } catch {
    console.error(JSON.stringify({ sms: 'lookup_failed' }))
    return unavailable(503)
  }
  if (!profileId) return json({})

  // The limit is counted here, where the code is sent, so calling Auth directly cannot get round it.
  try {
    if (!(await deps.sendAllowed(phone))) return unavailable(429)
  } catch {
    console.error(JSON.stringify({ sms: 'limit_check_failed' }))
    return unavailable(503)
  }

  const localId = (deps.newId ?? (() => crypto.randomUUID()))()
  // Supabase sends the number as digits without the +, so it is already E.164 with its own country code.
  const digits = phone.replace(/^\+/, '')
  // A log that can't be written must not stop a code from being sent.
  await deps.log({ profileId, phone: digits, kind: 'signin_code', template: deps.template, localId, broadcastId: null, status: 'accepted', error: null }).catch(() => {})
  const sent = await deps.wati.sendTemplate({ phone: `+${digits}`, template: deps.template, params: [otp], localMessageId: localId, broadcastName: 'signin_code' })
  const finish = (async () => {
    // The failure category, and WATI's own reason when it gave one (masked, short), so a refusal can be fixed from the log.
    await deps.logDone(localId, sent.ok ? sent.broadcastId : null, sent.ok ? null : sent.detail ? `${sent.category}: ${sent.detail}` : sent.category).catch(() => {})
    if (!sent.ok) await deps.sendRefund(phone).catch(() => {})
  })()
  if (deps.after) deps.after(finish)
  else await finish
  if (sent.ok) return json({})
  return unavailable(BUSY.has(sent.category) ? 503 : 500)
}
