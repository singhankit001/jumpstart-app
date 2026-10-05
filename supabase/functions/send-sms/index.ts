// Supabase Auth "Send SMS" hook (Authentication → Hooks): sends the sign-in code on WhatsApp through WATI. Supabase makes
// and checks the code; this only delivers it, and only to a number an active person with app access signs in with.
// Deploy: npx supabase functions deploy send-sms --no-verify-jwt   (required: Auth calls it with a signed webhook, not a user JWT)
// Secrets: SEND_SMS_HOOK_SECRET (the hook's "v1,whsec_..." secret), WATI_API_TOKEN, WATI_API_BASE_URL (optional),
// WATI_CHANNEL (optional), WATI_TEMPLATE_SIGNIN (optional, default jumpstart_signin_code).
import { createClient } from 'npm:@supabase/supabase-js@2'
import { Webhook } from 'npm:standardwebhooks@1.0.0'
import { createWati, templateName } from '../_shared/wati.ts'
import { handle } from './handler.ts'

const env = (name: string) => Deno.env.get(name)
// Read on every request, so a newly saved secret takes effect at once.
const hook = () => new Webhook((env('SEND_SMS_HOOK_SECRET') ?? '').replace(/^v1,whsec_/, ''))

const db = createClient(env('SUPABASE_URL')!, env('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

// Supabase's runtime keeps the function alive for work handed to it after the response: the WhatsApp send runs there,
// so Auth's 5-second limit on the hook never waits on WATI.
const runtime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime

Deno.serve((req) => {
  const wati = createWati({
    baseUrl: env('WATI_API_BASE_URL'),
    token: env('WATI_API_TOKEN'),
    channel: env('WATI_CHANNEL') || null,
    // One try gets the whole 10 seconds: a slow send cut off early may still be delivered, and a retry would send the
    // code twice. Only a quick refusal (429 or 5xx) is tried again.
    budgetMs: 10_000,
    attemptTimeoutMs: 10_000,
    maxAttempts: 3,
    fetch,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  })
  return handle(req, {
    after: runtime ? (work) => runtime.waitUntil(work) : undefined,
    verify: (raw, headers) => hook().verify(raw, headers),
    otpRecipient: async (phone) => {
      const { data, error } = await db.rpc('otp_recipient', { p_phone: phone })
      if (error) throw error
      return (data as string | null) ?? null
    },
    sendAllowed: async (phone) => {
      const { data, error } = await db.rpc('otp_send_allowed', { p_phone: phone })
      if (error) throw error
      return data === true
    },
    sendRefund: async (phone) => {
      const { error } = await db.rpc('otp_send_refund', { p_phone: phone })
      if (error) console.error(JSON.stringify({ sms: 'refund_failed', code: error.code }))
    },
    wati,
    template: templateName('SIGN_IN_CODE', env),
    log: async (r) => {
      // Category and counts only: never the number or the code.
      const { error } = await db.rpc('whatsapp_log_add', {
        p_profile: r.profileId, p_phone: `+${r.phone}`, p_kind: r.kind, p_template: r.template, p_local_id: r.localId,
        p_broadcast_id: r.broadcastId, p_status: r.status, p_error: r.error,
      })
      if (error) console.error(JSON.stringify({ sms: 'log_failed', code: error.code }))
    },
    logDone: async (localId, broadcastId, failure) => {
      const { error } = await db.rpc('whatsapp_log_finish', { p_local_id: localId, p_broadcast_id: broadcastId, p_error: failure })
      if (error) console.error(JSON.stringify({ sms: 'log_failed', code: error.code }))
      if (failure) console.error(JSON.stringify({ sms: 'send_failed', category: failure }))
    },
  })
})
