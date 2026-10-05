import { Link } from 'react-router'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, KeyRound, LogIn, Mail, MapPin, PencilLine, RotateCcw, Smartphone, UserCheck, WhatsApp } from '../../ui/icons'
import { BorderBeam } from '../../ui/BorderBeam'
import { Button } from '../../ui/Button'
import { Logo, Mascot } from '../../ui/Logo'
import { TextField } from '../../ui/Field'
import { formatMobile, normalizeMobile } from '../../domain/contact'
import { supabase } from '../../lib/supabase'
import { authMessage, passwordMessage } from './messages'
import { PasswordField } from './PasswordField'
import { chooseArea } from './session'

// Six digits, matching Supabase → Authentication → Providers → Phone → OTP Length (environments.md).
const CODE_LENGTH = 6
// Supabase sends one code per number a minute; the Send-a-new-code timer waits the same.
const RESEND_AFTER_S = 60

/** The number an invitation link carries after the #, read once and then cleared from the address bar. */
let invited: string | null = null
function invitedPhone(): string {
  if (invited === null) {
    const found = new URLSearchParams(location.hash.slice(1)).get('phone') ?? ''
    if (found) history.replaceState(null, '', location.pathname + location.search)
    invited = normalizeMobile(found) ?? ''
  }
  return invited
}

// Matches Supabase → Phone → OTP Expiration (environments.md): after this the code no longer works.
const CODE_VALID_S = 300
const PENDING_KEY = 'jumpstart.signinCode'

/**
 * The number a code was just sent to, kept on this device until the code expires. Reading the code means leaving for
 * WhatsApp, and Safari on iPhone often reloads the page on return (WhatsApp's own browser closes outright), which would
 * otherwise land the person back on the number with nowhere to type the code.
 */
const pendingCode = {
  get(): { to: string; at: number } | null {
    try {
      const p = JSON.parse(localStorage.getItem(PENDING_KEY) ?? 'null') as { to?: unknown; at?: unknown } | null
      if (!p || typeof p.to !== 'string' || typeof p.at !== 'number') return null
      const age = Date.now() - p.at
      return age >= 0 && age < CODE_VALID_S * 1000 ? { to: p.to, at: p.at } : null
    } catch { return null }
  },
  set(to: string) { try { localStorage.setItem(PENDING_KEY, JSON.stringify({ to, at: Date.now() })) } catch { /* storage blocked: this page only */ } },
  clear() { try { localStorage.removeItem(PENDING_KEY) } catch { /* nothing to clear */ } },
}

/** A code still waiting to be typed, unless an invitation link for a different number was just opened. */
function resumable() {
  const p = pendingCode.get()
  const inv = invitedPhone()
  return p && (!inv || inv === p.to) ? p : null
}

const PROMISES = [
  { icon: <UserCheck />, title: 'Invite only', text: 'The school adds every account.' },
  { icon: <KeyRound />, title: 'Code on WhatsApp', text: 'Stay signed in.' },
  { icon: <MapPin />, title: 'Private location', text: "Only you see who's collecting." },
]

/**
 * The sign-in page. Phones and upright tablets: a royal-purple brand band with the logo and the promise, and the card
 * rising over it. Wide screens: the brand panel on the left, the card centred on the right. Words kept to a minimum.
 */
export function SignInFrame({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col lg:grid lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1fr)] lg:p-4">
      <section aria-label="About Jumpstart Go"
        className="signin-hero relative flex min-h-[50dvh] flex-col justify-center gap-7 overflow-hidden rounded-b-[36px] px-6 pt-[max(24px,calc(env(safe-area-inset-top)+16px))] pb-20 text-ink sm:px-10 md:min-h-[54dvh] md:pb-24 lg:min-h-0 lg:justify-between lg:gap-10 lg:rounded-[32px] lg:p-12 xl:p-16">
        <div className="self-center rounded-[22px] bg-white px-5 py-3 shadow-[0_0_0_1px_rgb(120_80_40/0.08),0_14px_34px_-18px_rgb(120_60_30/0.45)] lg:self-start lg:px-6 lg:py-3.5">
          <Logo className="h-10 sm:h-11 lg:h-12" />
        </div>
        <div className="flex flex-col items-center text-center lg:items-start lg:text-left">
          <Mascot size={84} />
          <p className="mt-3 max-w-[14ch] text-[30px] leading-[1.08] font-extrabold tracking-[-0.02em] text-balance sm:text-[36px] lg:mt-5 lg:text-[52px] 2xl:text-[64px]" role="heading" aria-level={2}>
            Safe drop-offs and pickups
          </p>
          <p className="mt-3 text-body font-semibold text-ink-2 lg:text-lead">Jumpstart Preschool, Karve Road</p>
        </div>
        <ul className="hidden max-w-[520px] gap-3 lg:grid">
          {PROMISES.map((p) => (
            <li key={p.title} className="signin-pill flex items-center gap-3.5 rounded-2xl px-4 py-3">
              <span className="grid size-10 shrink-0 place-items-center signin-pill__icon rounded-xl [&_svg]:size-[22px]" aria-hidden>{p.icon}</span>
              <span className="text-body text-ink-2"><b className="text-ink">{p.title}.</b> {p.text}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="signin-side relative -mt-14 flex-1 px-4 pb-[max(24px,env(safe-area-inset-bottom))] sm:px-6 md:-mt-16 lg:mt-0 lg:flex lg:items-center lg:justify-center lg:px-10 lg:pb-0">
        <div className="mx-auto w-full max-w-[460px]">
          {children}
          <ul className="mt-6 flex flex-wrap justify-center gap-2 lg:hidden">
            {PROMISES.map((p) => (
              <li key={p.title} className="flex items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-caption font-bold text-ink-2 shadow-[var(--shadow-card)] [&_svg]:size-4 [&_svg]:shrink-0">{p.icon}{p.title}</li>
            ))}
          </ul>
          <nav aria-label="Policies" className="mt-5 flex justify-center gap-x-5 text-caption font-bold">
            <Link to="/privacy" className="linkbtn">Privacy Policy</Link>
            <Link to="/terms" className="linkbtn">Terms of Use</Link>
          </nav>
        </div>
      </section>
    </main>
  )
}

function FormError({ id, children }: { id: string; children: ReactNode }) {
  return <p id={id} className="text-center text-small font-bold text-danger" role="alert">{children}</p>
}

/**
 * Invite-only sign-in: a mobile number, then the 6-digit code that arrives on WhatsApp. Anyone whose record has an
 * email can instead sign in with it and a password (0041). Whoever signs in stays signed in until they tap Sign out.
 * Every answer reads the same whether or not the number or email is registered, so nobody can probe for accounts.
 */
export function LoginScreen() {
  // Back from WhatsApp after a reload: straight to the code box for the number it went to.
  const [resumed] = useState(resumable)
  const [step, setStep] = useState<'number' | 'code' | 'email'>(resumed ? 'code' : 'number')
  // From an invitation link (/#phone=…): the number is already filled in.
  const [phone, setPhone] = useState(() => formatMobile(resumed?.to ?? invitedPhone()))
  // The number the code went to, as stored (+ and the country code).
  const [sentTo, setSentTo] = useState(resumed?.to ?? '')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resendIn, setResendIn] = useState(() => resumed ? Math.max(0, RESEND_AFTER_S - Math.floor((Date.now() - resumed.at) / 1000)) : 0)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  // Guards against a double tap or Enter pressed twice before the busy state has rendered.
  const inFlight = useRef(false)
  const codeInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (resendIn <= 0) return
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [resendIn])

  function changeNumber() {
    pendingCode.clear()
    setStep('number')
    setError(null)
    setCode('')
  }

  async function run(task: () => Promise<void>) {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError(null)
    try {
      await task()
    } catch (e) {
      setError(authMessage(e as Error))
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  async function sendCode(e164: string) {
    await run(async () => {
      // Registered, active and under 10 codes an hour.
      const { data: allowed, error: checkError } = await supabase.rpc('phone_login_allowed', { p_phone: e164 })
      if (checkError) return setError(authMessage(checkError))
      if (allowed) {
        // shouldCreateUser: someone's first code creates their account, which the database links to the invite.
        const { error: otpError } = await supabase.auth.signInWithOtp({ phone: e164, options: { shouldCreateUser: true } })
        // Asked again within the minute: the code already sent still works, so carry on to it.
        if (otpError && !/after \d+ seconds?/i.test(otpError.message)) return setError(authMessage(otpError))
      }
      pendingCode.set(e164)
      setSentTo(e164)
      setStep('code')
      setCode('')
      setResendIn(RESEND_AFTER_S)
      setTimeout(() => codeInput.current?.focus(), 50)
    })
  }

  async function onNumber(e: FormEvent) {
    e.preventDefault()
    const e164 = normalizeMobile(phone)
    if (!e164) return setError('Enter a mobile number, like 98765 43210. Outside India, start with + and the country code.')
    setPhone(formatMobile(e164))
    await sendCode(e164)
  }

  async function onCode(e: FormEvent) {
    e.preventDefault()
    if (code.length !== CODE_LENGTH) return setError(`Enter all ${CODE_LENGTH} digits of the code.`)
    await run(async () => {
      // Asked before the session arrives, so the area chooser is ready the moment the app switches over.
      chooseArea.ask()
      const { error: verifyError } = await supabase.auth.verifyOtp({ phone: sentTo, token: code, type: 'sms' })
      // On success the session provider takes over and routes the person to their area.
      if (!verifyError) pendingCode.clear()
      else {
        chooseArea.done()
        setCode('')
        setError(authMessage(verifyError))
        codeInput.current?.focus()
      }
    })
  }

  function showEmail(on: boolean) {
    pendingCode.clear()
    setStep(on ? 'email' : 'number')
    setError(null)
    setPassword('')
  }

  async function onPassword(e: FormEvent) {
    e.preventDefault()
    const address = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return setError('Enter the email address the school has for you.')
    if (!password) return setError('Enter your password.')
    await run(async () => {
      chooseArea.ask()
      const { error: signError } = await supabase.auth.signInWithPassword({ email: address, password })
      if (signError) {
        chooseArea.done()
        setPassword('')
        setError(passwordMessage(signError))
      }
    })
  }

  return (
    <SignInFrame>
      <div className="card relative overflow-hidden rounded-[28px] p-6 shadow-[var(--shadow-lift)] sm:p-8">
        <BorderBeam />
        {step === 'number' && (
          <form key="number" onSubmit={(e) => void onNumber(e)} noValidate className="page-in grid gap-4">
            <div className="text-center">
              <p className="text-caption font-extrabold uppercase tracking-[0.14em] text-accent-ink">Welcome</p>
              <h1 className="mt-1 text-h1">Sign in to Jumpstart Go</h1>
              <p className="mt-2 text-body text-ink-2">Enter the mobile number the school has for you. We'll send a 6-digit code on WhatsApp.</p>
            </div>
            <TextField
              label="Mobile number"
              name="phone"
              icon={<Smartphone aria-hidden />}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              enterKeyHint="send"
              placeholder="98765 43210"
              hint="Outside India? Start with + and the country code."
              value={phone}
              onChange={(e) => { setPhone(e.target.value); setError(null) }}
              error={error}
              autoFocus
            />
            <Button type="submit" className="w-full" icon={<WhatsApp />} loading={busy}>
              {busy ? 'Sending code…' : 'Send code on WhatsApp'}<ArrowRight aria-hidden />
            </Button>
            <div className="signin-or" role="presentation"><span>or</span></div>
            <Button variant="secondary" className="w-full" icon={<Mail />} onClick={() => showEmail(true)}>
              Sign in with email and password
            </Button>
          </form>
        )}
        {step === 'code' && (
          <form key="code" onSubmit={(e) => void onCode(e)} noValidate className="page-in grid gap-4">
            <div className="text-center">
              <span className="mx-auto grid size-16 place-items-center rounded-2xl bg-[linear-gradient(155deg,#8a161b,#c8262c)] text-white shadow-[0_12px_24px_-12px_rgb(200_38_44/0.7)]">
                <WhatsApp className="size-8" aria-hidden />
              </span>
              <h1 className="mt-4 text-h2">Check WhatsApp</h1>
              <p className="mt-1.5 text-body text-ink-2" role="status">If this number is registered with Jumpstart, a 6-digit code is on its way on WhatsApp.</p>
              {/* The number the code went to, with Change right on it: where people look when it's the wrong one. */}
              <button type="button" className="phone-chip mt-3" aria-label={`Change number, now ${formatMobile(sentTo)}`} onClick={changeNumber}>
                <Smartphone className="phone-chip__icon" aria-hidden />
                <span className="min-w-0 truncate">{formatMobile(sentTo)}</span>
                <span className="phone-chip__edit"><PencilLine aria-hidden />Change</span>
              </button>
            </div>
            <div className="grid gap-1.5">
              <label htmlFor="code" className="px-0.5 text-center text-small font-bold text-ink-2">6-digit code</label>
              {/* One real, visible input: phones offer the code from the message, and it can be pasted, selected and copied. */}
              <input
                ref={codeInput}
                id="code"
                name="code"
                className="code-input"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH))
                  setError(null)
                }}
                inputMode="numeric"
                autoComplete="one-time-code"
                enterKeyHint="done"
                pattern="[0-9]*"
                placeholder="••••••"
                aria-invalid={!!error || undefined}
                aria-describedby={error ? 'code-error' : undefined}
              />
            </div>
            {error && <FormError id="code-error">{error}</FormError>}
            <Button type="submit" className="w-full" icon={<LogIn />} loading={busy} disabled={code.length !== CODE_LENGTH}>
              {busy ? 'Verifying…' : 'Continue'}
            </Button>
            <Button variant="quiet" size="md" className="mx-auto tabular-nums" icon={<RotateCcw />} disabled={resendIn > 0 || busy} onClick={() => void sendCode(sentTo)}>
              {resendIn > 0 ? `Send a new code in ${resendIn}s` : 'Send a new code'}
            </Button>
            <div className="justify-self-center">
              <button type="button" className="linkbtn -ml-2 inline-flex items-center gap-1.5 [&_svg]:size-4" onClick={changeNumber}>
                <ArrowLeft aria-hidden />Use a different number
              </button>
            </div>
          </form>
        )}
        {step === 'email' && (
          <form key="email" onSubmit={(e) => void onPassword(e)} noValidate className="page-in grid gap-4">
            <div className="text-center">
              <span className="signin-badge mx-auto" aria-hidden><KeyRound /></span>
              <h1 className="mt-4 text-h2">Sign in with email</h1>
              <p className="mt-1.5 text-body text-ink-2">Use the email the school has for you and your password.</p>
            </div>
            <TextField
              label="Email"
              name="email"
              icon={<Mail aria-hidden />}
              type="email"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              enterKeyHint="next"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(null) }}
              autoFocus
            />
            <PasswordField
              label="Password"
              name="password"
              autoComplete="current-password"
              enterKeyHint="go"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(null) }}
              error={error}
            />
            <Button type="submit" className="w-full" icon={<LogIn />} loading={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
            <p className="text-center text-caption font-semibold text-ink-2 text-pretty">
              Forgot your password? Sign in with your mobile number, or ask the school to reset it.
            </p>
            <div className="justify-self-center">
              <button type="button" className="linkbtn -ml-2 inline-flex items-center gap-1.5 [&_svg]:size-4" onClick={() => showEmail(false)}>
                <ArrowLeft aria-hidden />Use my mobile number instead
              </button>
            </div>
          </form>
        )}
      </div>
    </SignInFrame>
  )
}
