import { describe, expect, it, vi } from 'vitest'
import { handle, type Deps } from './handler'
import type { WhatsAppLogRow } from '../_shared/wati'

function setupDeps(over: Partial<Deps> = {}) {
  const logs: WhatsAppLogRow[] = []
  const deps: Deps = {
    verify: vi.fn((raw) => JSON.parse(raw)),
    otpRecipient: vi.fn(async (phone) => (phone === '+919822000001' || phone === '6591234567' || phone === '14155552671' ? 'profile-uuid-1' : null)),
    sendAllowed: vi.fn(async () => true),
    sendRefund: vi.fn(async () => {}),
    wati: {
      sendTemplate: vi.fn(async () => ({ ok: true, broadcastId: 'bc-999', localId: 'test-local-id' })),
    },
    log: vi.fn(async (row) => {
      logs.push(row)
    }),
    logDone: vi.fn(async () => {}),
    template: 'jumpstart_signin_code',
    newId: () => 'fixed-local-id',
    ...over,
  }
  return { deps, logs }
}

describe('send-sms hook handler', () => {
  it('rejects non-POST methods with 405', async () => {
    const { deps } = setupDeps()
    const req = new Request('https://example.com', { method: 'GET' })
    const res = await handle(req, deps)
    expect(res.status).toBe(405)
  })

  it('rejects invalid signature with 401', async () => {
    const { deps } = setupDeps({
      verify: () => {
        throw new Error('invalid signature')
      },
    })
    const req = new Request('https://example.com', {
      method: 'POST',
      body: JSON.stringify({ user: { phone: '+919822000001' }, sms: { otp: '123456' } }),
    })
    const res = await handle(req, deps)
    expect(res.status).toBe(401)
  })

  it('rejects malformed payload with 400', async () => {
    const { deps } = setupDeps()
    const req = new Request('https://example.com', {
      method: 'POST',
      body: JSON.stringify({ invalid: true }),
    })
    const res = await handle(req, deps)
    expect(res.status).toBe(400)
  })

  it('returns empty 200 without sending WhatsApp when recipient is not registered (anti-enumeration)', async () => {
    const { deps, logs } = setupDeps()
    const req = new Request('https://example.com', {
      method: 'POST',
      body: JSON.stringify({ user: { phone: '+919899999999' }, sms: { otp: '123456' } }),
    })
    const res = await handle(req, deps)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({})
    expect(deps.wati.sendTemplate).not.toHaveBeenCalled()
    expect(logs).toHaveLength(0)
  })

  it('sends WATI template and writes audit log for registered recipient', async () => {
    const { deps, logs } = setupDeps()
    const req = new Request('https://example.com', {
      method: 'POST',
      body: JSON.stringify({ user: { phone: '+919822000001' }, sms: { otp: '654321' } }),
    })
    const res = await handle(req, deps)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({})

    expect(deps.wati.sendTemplate).toHaveBeenCalledWith({
      phone: '+919822000001',
      template: 'jumpstart_signin_code',
      params: ['654321'],
      localMessageId: 'fixed-local-id',
      broadcastName: 'signin_code',
    })

    expect(logs).toHaveLength(1)
    expect(logs[0]).toEqual({
      profileId: 'profile-uuid-1',
      phone: '919822000001',
      kind: 'signin_code',
      template: 'jumpstart_signin_code',
      localId: 'fixed-local-id',
      broadcastId: null,
      status: 'accepted',
      error: null,
    })
    expect(deps.logDone).toHaveBeenCalledWith('fixed-local-id', 'bc-999', null)
  })

  it('returns safe error envelope if WATI fails due to rate limiting or downtime', async () => {
    const { deps } = setupDeps({
      wati: {
        sendTemplate: vi.fn(async () => ({
          ok: false,
          category: 'rate_limited',
          retryable: true,
          localId: 'fixed-local-id',
        })),
      },
    })
    const req = new Request('https://example.com', {
      method: 'POST',
      body: JSON.stringify({ user: { phone: '+919822000001' }, sms: { otp: '654321' } }),
    })
    const res = await handle(req, deps)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({
      error: {
        http_code: 503,
        message: "Couldn't send the WhatsApp code right now.",
      },
    })
  })

  it.each([
    ['6591234567', '+6591234567'],
    ['14155552671', '+14155552671'],
  ])('keeps the country code of %s instead of prefixing 91', async (phone, expected) => {
    const { deps, logs } = setupDeps()
    await handle(new Request('https://example.com', { method: 'POST', body: JSON.stringify({ user: { phone }, sms: { otp: '111111' } }) }), deps)
    expect(deps.wati.sendTemplate).toHaveBeenCalledWith(expect.objectContaining({ phone: expected }))
    expect(logs[0].phone).toBe(phone)
  })

  it('writes the log row before calling WATI and records a failure on it', async () => {
    const order: string[] = []
    const { deps } = setupDeps({
      log: vi.fn(async () => { order.push('log') }),
      wati: { sendTemplate: vi.fn(async () => { order.push('send'); return { ok: false as const, category: 'rejected' as const, retryable: false, localId: 'x' } }) },
    })
    const res = await handle(new Request('https://example.com', { method: 'POST', body: JSON.stringify({ user: { phone: '+919822000001' }, sms: { otp: '1' } }) }), deps)
    expect(order).toEqual(['log', 'send'])
    expect(deps.logDone).toHaveBeenCalledWith('fixed-local-id', null, 'rejected')
    expect((await res.json()).error.http_code).toBe(500)
  })

  it("gives the place back when WATI didn't send the code (no credit), but not when it did", async () => {
    const failed = setupDeps({ wati: { sendTemplate: vi.fn(async () => ({ ok: false as const, category: 'rejected' as const, retryable: false, localId: 'x', detail: 'Not enough credits to send the message' })) } }).deps
    await handle(new Request('https://example.com', { method: 'POST', body: JSON.stringify({ user: { phone: '+919822000001' }, sms: { otp: '1' } }) }), failed)
    expect(failed.sendRefund).toHaveBeenCalledTimes(1)
    expect(failed.logDone).toHaveBeenCalledWith('fixed-local-id', null, 'rejected: Not enough credits to send the message')
    const sent = setupDeps().deps
    await handle(new Request('https://example.com', { method: 'POST', body: JSON.stringify({ user: { phone: '+919822000001' }, sms: { otp: '1' } }) }), sent)
    expect(sent.sendRefund).not.toHaveBeenCalled()
  })

  it('still sends when the log row cannot be written', async () => {
    const { deps } = setupDeps({ log: vi.fn(async () => { throw new Error('db') }) })
    const res = await handle(new Request('https://example.com', { method: 'POST', body: JSON.stringify({ user: { phone: '+919822000001' }, sms: { otp: '1' } }) }), deps)
    expect(deps.wati.sendTemplate).toHaveBeenCalled()
    expect(await res.json()).toEqual({})
  })

  it('answers with the error envelope when the recipient lookup fails', async () => {
    const { deps } = setupDeps({ otpRecipient: vi.fn(async () => { throw new Error('db down') }) })
    const res = await handle(new Request('https://example.com', { method: 'POST', body: JSON.stringify({ user: { phone: '+919822000001' }, sms: { otp: '1' } }) }), deps)
    expect(res.status).toBe(200)
    expect((await res.json()).error.http_code).toBe(503)
    expect(deps.wati.sendTemplate).not.toHaveBeenCalled()
  })

  it('refuses a send once the number is over its hourly limit', async () => {
    const { deps } = setupDeps({ sendAllowed: vi.fn(async () => false) })
    const res = await handle(new Request('https://example.com', { method: 'POST', body: JSON.stringify({ user: { phone: '+919822000001' }, sms: { otp: '1' } }) }), deps)
    const json = await res.json()
    expect(json.error.http_code).toBe(429)
    expect(json.error.message).toMatch(/too many attempts/i)
    expect(deps.wati.sendTemplate).not.toHaveBeenCalled()
  })

  it('does not spend the limit on an unregistered number', async () => {
    const { deps } = setupDeps()
    await handle(new Request('https://example.com', { method: 'POST', body: JSON.stringify({ user: { phone: '+919899999999' }, sms: { otp: '1' } }) }), deps)
    expect(deps.sendAllowed).not.toHaveBeenCalled()
  })

  it("answers Auth as soon as WATI has the code, without waiting on the log (Auth's 5-second limit)", async () => {
    let release!: () => void
    const held = new Promise<void>((r) => { release = r })
    const deferred: Promise<unknown>[] = []
    const { deps } = setupDeps({ logDone: vi.fn(() => held), after: (work) => { deferred.push(work) } })
    const res = await handle(new Request('https://example.com', { method: 'POST', body: JSON.stringify({ user: { phone: '+919822000001' }, sms: { otp: '1' } }) }), deps)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({})
    // Still recorded, after the answer.
    expect(deps.logDone).toHaveBeenCalledWith('fixed-local-id', 'bc-999', null)
    expect(deferred).toHaveLength(1)
    release()
    await deferred[0]
  })

  it('still refunds a failed send after answering', async () => {
    const deferred: Promise<unknown>[] = []
    const { deps } = setupDeps({
      wati: { sendTemplate: vi.fn(async () => ({ ok: false as const, category: 'rejected' as const, retryable: false, localId: 'x' })) },
      after: (work) => { deferred.push(work) },
    })
    const res = await handle(new Request('https://example.com', { method: 'POST', body: JSON.stringify({ user: { phone: '+919822000001' }, sms: { otp: '1' } }) }), deps)
    expect((await res.json()).error.http_code).toBe(500)
    await Promise.all(deferred)
    expect(deps.sendRefund).toHaveBeenCalledWith('+919822000001')
  })
})
