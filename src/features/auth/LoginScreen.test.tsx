// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { ToastProvider } from '../../ui/Toast'

const auth = vi.hoisted(() => ({
  signInWithOtp: vi.fn(),
  signInWithPassword: vi.fn(),
  verifyOtp: vi.fn(),
  rpc: vi.fn(),
}))
vi.mock('../../lib/supabase', () => ({
  supabase: { rpc: auth.rpc, auth: { signInWithOtp: auth.signInWithOtp, signInWithPassword: auth.signInWithPassword, verifyOtp: auth.verifyOtp } },
}))

/** A fresh copy of the screen: the invitation number is read once per module load, so each test starts clean. */
async function open(hash = '') {
  history.replaceState(null, '', `/${hash}`)
  vi.resetModules()
  const { LoginScreen } = await import('./LoginScreen')
  const user = userEvent.setup()
  render(<MemoryRouter><ToastProvider><LoginScreen /></ToastProvider></MemoryRouter>)
  return user
}

async function askForCode(user: ReturnType<typeof userEvent.setup>, number = '98765 43210') {
  await user.type(screen.getByLabelText('Mobile number'), number)
  await user.click(screen.getByRole('button', { name: /Send code on WhatsApp/ }))
}

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  auth.signInWithOtp.mockResolvedValue({ data: {}, error: null })
  auth.verifyOtp.mockResolvedValue({ data: {}, error: null })
  auth.rpc.mockResolvedValue({ data: true, error: null })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
})

it('starts with the mobile number, with the phone keyboard and autofill hints, and email sign-in one tap away', async () => {
  await open()
  const field = screen.getByLabelText('Mobile number')
  expect(field).toHaveAttribute('type', 'tel')
  expect(field).toHaveAttribute('autocomplete', 'tel')
  expect(field).toHaveAttribute('placeholder', '98765 43210')
  expect(screen.getByText('Outside India? Start with + and the country code.')).toBeInTheDocument()
  // Email and password are the second way in (D52): offered, but not asked for until chosen.
  expect(screen.queryByLabelText(/email|password/i)).toBeNull()
  expect(screen.getByRole('button', { name: 'Sign in with email and password' })).toBeInTheDocument()
})

it('sends a registered number its code on WhatsApp, as a full international number', async () => {
  const user = await open()
  await askForCode(user)
  expect(await screen.findByRole('heading', { name: 'Check WhatsApp' })).toBeInTheDocument()
  expect(auth.rpc).toHaveBeenCalledWith('phone_login_allowed', { p_phone: '+919876543210' })
  expect(auth.signInWithOtp).toHaveBeenCalledWith({ phone: '+919876543210', options: { shouldCreateUser: true } })
  expect(screen.getByRole('button', { name: /Change number, now \+91 98765 43210/ })).toBeInTheDocument()
})

it('takes numbers from other countries', async () => {
  const user = await open()
  await askForCode(user, '+971 50 123 4567')
  await screen.findByRole('heading', { name: 'Check WhatsApp' })
  expect(auth.signInWithOtp).toHaveBeenCalledWith({ phone: '+971501234567', options: { shouldCreateUser: true } })
})

it('answers the same way for an unregistered number, and sends it nothing', async () => {
  auth.rpc.mockResolvedValue({ data: false, error: null })
  const user = await open()
  await askForCode(user, '98765 11111')
  expect(await screen.findByRole('heading', { name: 'Check WhatsApp' })).toBeInTheDocument()
  expect(screen.getByText(/If this number is registered with Jumpstart/)).toBeInTheDocument()
  expect(auth.signInWithOtp).not.toHaveBeenCalled()
})

it('checks the number before calling the server', async () => {
  const user = await open()
  await user.type(screen.getByLabelText('Mobile number'), '12345')
  await user.click(screen.getByRole('button', { name: /Send code on WhatsApp/ }))
  expect(screen.getByRole('alert')).toHaveTextContent('Enter a mobile number')
  expect(auth.rpc).not.toHaveBeenCalled()
})

it('goes on to the code already sent when asked again within the minute', async () => {
  auth.signInWithOtp.mockResolvedValue({ data: {}, error: { status: 429, message: 'For security purposes, you can only request this after 42 seconds.' } })
  const user = await open()
  await askForCode(user)
  expect(await screen.findByRole('heading', { name: 'Check WhatsApp' })).toBeInTheDocument()
})

it('says the code could not be sent when the WhatsApp hook fails, without the server text', async () => {
  auth.signInWithOtp.mockResolvedValue({ data: {}, error: { status: 500, code: 'unexpected_failure', message: 'Error sending sms: hook returned 503' } })
  const user = await open()
  await askForCode(user)
  expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't send the WhatsApp code right now. Please try again in a moment.")
  expect(screen.queryByText(/hook returned/)).toBeNull()
  expect(screen.getByRole('heading', { name: 'Sign in to Jumpstart Go' })).toBeInTheDocument()
})

it('stops at "too many" once the hourly code limit is reached', async () => {
  auth.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'rate_limited: login:+919876543210' } })
  const user = await open()
  await askForCode(user)
  expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts')
  expect(screen.queryByText(/login:/)).toBeNull()
  expect(auth.signInWithOtp).not.toHaveBeenCalled()
})

it('takes a pasted code with spaces and checks it once as an sms code', async () => {
  const user = await open()
  await askForCode(user)
  const code = await screen.findByLabelText('6-digit code')
  // A real, visible input: pasting works, and what was pasted is plain text in it.
  expect(code).toHaveAttribute('autocomplete', 'one-time-code')
  await user.click(code)
  await user.paste('12 34-56')
  expect(code).toHaveValue('123456')
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  await waitFor(() => expect(auth.verifyOtp).toHaveBeenCalledTimes(1))
  expect(auth.verifyOtp).toHaveBeenCalledWith({ phone: '+919876543210', token: '123456', type: 'sms' })
  // Asked before the session arrives, so the area chooser is ready.
  expect(sessionStorage.getItem('jumpstart.chooseArea')).toBe('1')
})

it('clears the code and the area chooser when a code is wrong or expired', async () => {
  auth.verifyOtp.mockResolvedValue({ data: {}, error: { code: 'otp_expired', status: 403, message: 'Token has expired or is invalid' } })
  const user = await open()
  await askForCode(user)
  await user.type(await screen.findByLabelText('6-digit code'), '000000')
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  expect(await screen.findByRole('alert')).toHaveTextContent("This code isn't right or has expired")
  expect(screen.getByLabelText('6-digit code')).toHaveValue('')
  expect(sessionStorage.getItem('jumpstart.chooseArea')).toBeNull()
})

it('sends one request however many times the button is pressed', async () => {
  let finish: (v: unknown) => void = () => {}
  auth.rpc.mockReturnValue(new Promise((r) => { finish = r }))
  const user = await open()
  await user.type(screen.getByLabelText('Mobile number'), '98765 43210')
  const form = screen.getByLabelText('Mobile number').closest('form')!
  // Two submits in the same tick, before React has rendered the busy state: only the in-flight guard stops the second.
  act(() => { form.requestSubmit(); form.requestSubmit() })
  expect(auth.rpc).toHaveBeenCalledTimes(1)
  finish({ data: true, error: null })
  await screen.findByRole('heading', { name: 'Check WhatsApp' })
})

it('lets a new code be asked for only after the 60 second wait, and Change goes back with the number kept', async () => {
  const user = await open()
  await askForCode(user)
  await screen.findByRole('heading', { name: 'Check WhatsApp' })
  expect(screen.getByRole('button', { name: /Send a new code in \d+s/ })).toBeDisabled()
  expect(screen.getByRole('button', { name: /Send a new code in 6\ds/ })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: /Change number/ }))
  expect(screen.getByLabelText('Mobile number')).toHaveValue('+91 98765 43210')
})

it('enables Send a new code when the countdown ends, and sends to the same number', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  history.replaceState(null, '', '/')
  vi.resetModules()
  const { LoginScreen } = await import('./LoginScreen')
  render(<MemoryRouter><ToastProvider><LoginScreen /></ToastProvider></MemoryRouter>)
  await askForCode(user)
  await screen.findByRole('heading', { name: 'Check WhatsApp' })
  for (let i = 0; i < 60; i++) {
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
  }
  const again = screen.getByRole('button', { name: 'Send a new code' })
  expect(again).toBeEnabled()
  await user.click(again)
  await waitFor(() => expect(auth.signInWithOtp).toHaveBeenCalledTimes(2))
  expect(auth.signInWithOtp).toHaveBeenLastCalledWith({ phone: '+919876543210', options: { shouldCreateUser: true } })
})

it('opens an invitation link with the number filled in, then clears it from the address', async () => {
  await open('#phone=%2B919220991947')
  expect(screen.getByLabelText('Mobile number')).toHaveValue('+91 92209 91947')
  expect(location.hash).toBe('')
})

it('never shows a code on screen and has no shortcut sign-ins', async () => {
  const user = await open()
  expect(screen.queryByRole('button', { name: /Parent \(|Admin \(|Coordinator \(|Leader \(/ })).toBeNull()
  await askForCode(user)
  await screen.findByRole('heading', { name: 'Check WhatsApp' })
  expect(auth.rpc).not.toHaveBeenCalledWith('request_screen_otp', expect.anything())
  expect(screen.getByLabelText('6-digit code')).toHaveValue('')
})

async function openEmail() {
  const user = await open()
  await user.click(screen.getByRole('button', { name: 'Sign in with email and password' }))
  return user
}

it('signs in with an email and password, the email tidied', async () => {
  auth.signInWithPassword.mockResolvedValue({ data: {}, error: null })
  const user = await openEmail()
  expect(screen.getByRole('heading', { name: 'Sign in with email' })).toBeInTheDocument()
  expect(screen.getByLabelText('Email')).toHaveAttribute('autocomplete', 'username')
  const password = screen.getByLabelText('Password')
  expect(password).toHaveAttribute('type', 'password')
  expect(password).toHaveAttribute('autocomplete', 'current-password')
  await user.type(screen.getByLabelText('Email'), '  Meera.Shah@Gmail.com ')
  await user.type(password, 'Meera@gmail#2026')
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
  await waitFor(() => expect(auth.signInWithPassword).toHaveBeenCalledTimes(1))
  expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: 'meera.shah@gmail.com', password: 'Meera@gmail#2026' })
  expect(sessionStorage.getItem('jumpstart.chooseArea')).toBe('1')
})

it('shows and hides the password', async () => {
  const user = await openEmail()
  await user.click(screen.getByRole('button', { name: 'Show password' }))
  expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text')
  await user.click(screen.getByRole('button', { name: 'Hide password' }))
  expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password')
})

it('says the same thing for a wrong email or a wrong password, and clears the password', async () => {
  auth.signInWithPassword.mockResolvedValue({ data: {}, error: { code: 'invalid_credentials', status: 400, message: 'Invalid login credentials' } })
  const user = await openEmail()
  await user.type(screen.getByLabelText('Email'), 'someone@example.com')
  await user.type(screen.getByLabelText('Password'), 'wrong-one')
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
  expect(await screen.findByRole('alert')).toHaveTextContent("That email and password don't match. Check them, or sign in with your mobile number.")
  expect(screen.getByLabelText('Password')).toHaveValue('')
  expect(sessionStorage.getItem('jumpstart.chooseArea')).toBeNull()
})

it('checks the email and password are there before calling the server', async () => {
  const user = await openEmail()
  await user.type(screen.getByLabelText('Email'), 'not-an-email')
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Enter the email address the school has for you.')
  await user.clear(screen.getByLabelText('Email'))
  await user.type(screen.getByLabelText('Email'), 'meera@gmail.com')
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Enter your password.')
  expect(auth.signInWithPassword).not.toHaveBeenCalled()
})

it('goes back to the mobile number from email sign-in', async () => {
  const user = await openEmail()
  await user.click(screen.getByRole('button', { name: /Use my mobile number instead/ }))
  expect(screen.getByLabelText('Mobile number')).toBeInTheDocument()
})

it('comes back to the code box after the page reloads on the way back from WhatsApp, and lets the code in', async () => {
  let user = await open()
  await askForCode(user)
  await screen.findByRole('heading', { name: 'Check WhatsApp' })
  // Safari on iPhone reloads the page (or WhatsApp's browser closes) while the person reads the code.
  cleanup()
  user = await open()
  expect(screen.getByRole('heading', { name: 'Check WhatsApp' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Change number, now \+91 98765 43210/ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Send a new code in \d+s/ })).toBeDisabled()
  await user.type(screen.getByLabelText('6-digit code'), '123456')
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  expect(auth.verifyOtp).toHaveBeenCalledWith({ phone: '+919876543210', token: '123456', type: 'sms' })
  expect(auth.signInWithOtp).toHaveBeenCalledTimes(1)
  // Signed in: the next visit starts fresh.
  await waitFor(() => expect(localStorage.getItem('jumpstart.signinCode')).toBeNull())
})

it('starts at the number again once the code has expired, after Change number, or for an invitation to another number', async () => {
  localStorage.setItem('jumpstart.signinCode', JSON.stringify({ to: '+919876543210', at: Date.now() - 301_000 }))
  await open()
  expect(screen.getByLabelText('Mobile number')).toBeInTheDocument()

  cleanup()
  let user = await open()
  await askForCode(user)
  await user.click(await screen.findByRole('button', { name: 'Use a different number' }))
  cleanup()
  await open()
  expect(screen.getByLabelText('Mobile number')).toBeInTheDocument()

  cleanup()
  user = await open()
  await askForCode(user)
  await screen.findByRole('heading', { name: 'Check WhatsApp' })
  cleanup()
  await open('#phone=9800011111')
  expect(screen.getByLabelText('Mobile number')).toHaveValue('+91 98000 11111')
})
