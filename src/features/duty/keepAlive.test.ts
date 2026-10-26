// The silent loop on iPhone and iPad before iOS 17 (sound.ts): only while on duty and only while the page is on screen.
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('./voiceClips', () => ({
  clearRetiredVoiceCaches: async () => {}, voiceChild: () => null, markVoice: () => {}, voiceLog: () => {}, lastVoiceProblem: () => null,
  storedClipAudio: async () => null, secs: () => null, loadVoiceVersion: async () => null, clipAudio: async () => ({}),
}))

class FakeAudio { paused = true; loop = false; play = vi.fn(async () => { this.paused = false }); pause = vi.fn(() => { this.paused = true }); setAttribute() {} }
const made: FakeAudio[] = []
const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as 'visible' | 'hidden' })
const show = (v: 'visible' | 'hidden') => { doc.visibilityState = v; doc.dispatchEvent(new Event('visibilitychange')) }

let sound: typeof import('./sound')
beforeAll(async () => {
  class Ctx extends EventTarget { state = 'running'; currentTime = 0; destination = {}; resume = async () => {}; createBufferSource() { return { connect() {}, start() {} } } createBuffer() { return {} } }
  Object.assign(globalThis, {
    window: globalThis, document: doc, AudioContext: Ctx,
    Audio: class { constructor() { const a = new FakeAudio(); made.push(a); return a } },
    URL: Object.assign(URL, { createObjectURL: () => 'blob:silence' }),
  })
  // An iPad on iPadOS 16: no Audio Session API.
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'Mozilla/5.0 (iPad; CPU OS 16_7 like Mac OS X)', maxTouchPoints: 5 }, configurable: true })
  sound = await import('./sound')
})

describe('silent loop before iOS 17', () => {
  it('plays on duty, stops while hidden, and starts again on return', () => {
    sound.unlockSound()
    const loop = made[0]!
    expect(loop.loop).toBe(true)
    expect(loop.paused).toBe(false)
    show('hidden')
    expect(loop.paused).toBe(true)
    show('visible')
    expect(loop.paused).toBe(false)
  })

  it('stays off after End duty, even when the app comes back to the screen', () => {
    const loop = made[0]!
    sound.releaseSound()
    expect(loop.paused).toBe(true)
    show('hidden')
    show('visible')
    expect(loop.paused).toBe(true)
  })
})
