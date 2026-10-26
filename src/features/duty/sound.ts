import { DEFAULT_OPENINGS, voiceParts } from '../../../supabase/functions/_shared/announce.ts'
import type { AnnouncerOutput, ChimeKind } from './announcer'
import { clearRetiredVoiceCaches, clipAudio, lastVoiceProblem, loadVoiceVersion, markVoice, secs, storedClipAudio, voiceChild, voiceLog } from './voiceClips'

/**
 * Chime and voice for announcements on the coordinator's iPad (PRD D7, D50). The voice is the school's Indian English
 * voice (Azure), made ahead of time for every child and kept on the iPad (voiceClips.ts). When a clip isn't ready soon
 * after the chime, the iPad's own Indian English voice says it instead; without one, the chime and the screen carry it.
 * iPadOS only allows sound after a tap, so `unlockSound()` must run inside the Start duty tap.
 */

// The admin's openings (0042): each is kept on the iPad as its own clip, so the voice must know them to split it off.
let openings: readonly string[] = DEFAULT_OPENINGS
export const setVoiceOpenings = (list: readonly string[]) => { openings = list }

let ctx: AudioContext | null = null
// Bumped by stopSound. Anything started before a Stop (a clip still downloading, a sentence still queued) checks it
// and never plays afterwards, so End duty and Mute are silent at once.
let generation = 0
// Everything now sounding through Web Audio: chime notes and voice clips.
const sounding = new Set<AudioScheduledSourceNode>()
// Ends the device voice's sentence at once: browsers don't always fire onend/onerror after cancel().
let endDevice: (() => void) | null = null
// Safari can skip `onend` for utterances that were garbage-collected, so keep the current one referenced.
let utterance: SpeechSynthesisUtterance | null = null

export const soundSupported = typeof window !== 'undefined' && 'AudioContext' in window
const speechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window

/**
 * How long each part may keep the gate waiting for the school's voice (Azure, an Indian woman, en-IN-NeerjaNeural)
 * before the device's own Indian woman's voice says it instead: the opening, after the chime; the message, after the
 * opening. Clips already kept on the iPad play at once; one made on the spot takes about 1 to 2 s. Long enough that the
 * gate nearly always hears the school's voice, short enough that it never waits long.
 */
export const CLIP_BUDGET_MS = 2500
/**
 * The sound check after Start duty waits longer: it is the day's first request, so the pronounce function may be
 * starting up, and the check should sound like the real gate, not the tablet's voice.
 */
export const SOUND_CHECK_BUDGET_MS = 8000
/**
 * Without an Indian woman's voice on the device (an iPhone by default has only Rishi, a man), the fallback is another
 * accent (Samantha, American): the gate waits longer for the school's own voice before using it.
 */
export const NO_INDIAN_VOICE_BUDGET_MS = 6000
// The natural pause after "New announcement." before the message.
const PART_GAP_MS = 150

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// iOS hands the audio session back when the silent unlock sentence (unlockSound) ends, and that interrupts any Web Audio
// playing at that moment: the sound check was cut after its first two words. Sound waits for that sentence to finish,
// at most this long (it is one short word; a voice that never reports its end mustn't hold the gate).
const UNLOCK_SETTLE_MS = 1500
// A clip that reports its end more than this before its length did not finish (seconds of audio clock).
const EARLY_END_S = 0.25
let unlocking: Promise<void> | null = null

// iPhone and iPad before iOS 17 have no Audio Session API, and their Web Audio is muted by the ring/silent switch. A
// playing media element moves the page into the "playback" audio category, which the switch doesn't mute, so on those
// devices a silent loop plays for the whole duty. It is pure silence; nothing is ever heard from it.
let keepAlive: HTMLAudioElement | null = null
// On duty (unlockSound) until End duty (releaseSound): a paused loop is started again on return only while this holds.
let keepAliveWanted = false
const isApple = () => typeof navigator !== 'undefined' && (/iPhone|iPad/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1))
function silentWav(seconds = 1, rate = 8000): string {
  const n = seconds * rate
  const b = new DataView(new ArrayBuffer(44 + n))
  const text = (o: number, s: string) => [...s].forEach((c, i) => b.setUint8(o + i, c.charCodeAt(0)))
  text(0, 'RIFF'); b.setUint32(4, 36 + n, true); text(8, 'WAVEfmt '); b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true)
  b.setUint32(24, rate, true); b.setUint32(28, rate, true); b.setUint16(32, 1, true); b.setUint16(34, 8, true); text(36, 'data'); b.setUint32(40, n, true)
  for (let i = 0; i < n; i++) b.setUint8(44 + i, 128) // 8-bit PCM silence is 128
  return URL.createObjectURL(new Blob([b.buffer], { type: 'audio/wav' }))
}

/** Call from a tap (Start duty, Resume, or "turn sound back on"). Unlocks the chime and both voices for the session. */
export function unlockSound(): void {
  // Play through the speaker even when the ring/silent switch is on (WebKit Audio Session API, iOS 17+).
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession
  if (session) session.type = 'playback'
  else if (isApple() && typeof Audio !== 'undefined') {
    keepAliveWanted = true
    keepAlive ??= Object.assign(new Audio(silentWav()), { loop: true })
    keepAlive.setAttribute('playsinline', '')
    void keepAlive.play().catch(() => {})
  }
  const audio = audioContext()
  // Some iOS versions only count Web Audio as started by the tap once a buffer has actually played inside it.
  try {
    const src = audio.createBufferSource()
    src.buffer = audio.createBuffer(1, 1, 22050)
    src.connect(audio.destination)
    src.start(0)
  } catch { /* nothing to warm up */ }
  // iOS unlocks the device voice only for a real sentence spoken inside a tap; an empty one is dropped. It is meant to be
  // silent, but iPhone and iPad ignore `volume` for speech, so it is said in the same woman's voice the gate would use:
  // with no voice chosen, an Indian iPad says it in Rishi, a man's voice. Without a woman's voice there is no device
  // voice to unlock (speakDevice would never use another), so nothing is said.
  const unlockVoice = speechSupported ? pickFallbackVoice(speechSynthesis.getVoices()) : null
  if (speechSupported && !unlockVoice) voiceLog('device-voice-unavailable', { at: 'unlock', voices: speechSynthesis.getVoices().length })
  if (unlockVoice) {
    speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance('Ready.')
    u.voice = unlockVoice
    u.lang = unlockVoice.lang
    u.volume = 0
    const pending: Promise<void> = new Promise<void>((done) => {
      const settle = setTimeout(done, UNLOCK_SETTLE_MS)
      u.onend = u.onerror = () => { clearTimeout(settle); done() }
    }).then(() => { if (unlocking === pending) unlocking = null })
    unlocking = pending
    // Kept referenced: Safari can skip onend for an utterance it garbage-collected.
    utterance = u
    speechSynthesis.speak(u)
  }
  // Which voice the school's clips are in, then free the space older versions used on this iPad.
  void loadVoiceVersion().then(clearRetiredVoiceCaches)
}

/** Ends the duty's audio session: the silent keep-alive stops, so the device's own sound rules apply again. */
export function releaseSound(): void {
  keepAliveWanted = false
  keepAlive?.pause()
}

/** Whether the gate can make sound right now without another tap: Web Audio running (resumed if iOS paused it). */
export async function soundReady(): Promise<boolean> {
  if (!ctx) return false
  return running(ctx)
}

/** The shared audio output, resumed (call from a tap, e.g. a pronunciation preview). */
export function audioContext(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext()
    // iOS pauses Web Audio when the iPad locks or another app takes the sound; ask for it back on return.
    // pageshow: an installed app restored from memory may skip visibilitychange; focus: back from another app.
    const back = () => { if (document.visibilityState === 'visible' && ctx && ctx.state !== 'running') void ctx.resume().catch(() => {}) }
    globalThis.document?.addEventListener('visibilitychange', back)
    globalThis.addEventListener?.('pageshow', back)
    globalThis.addEventListener?.('focus', back)
    // The silent loop keeps playing while the page is hidden or the device is locked: a playing media element is what keeps
    // the duty's audio running there, so pausing it silenced announcements with the screen off. iOS may still pause it with
    // the rest of the page's media; it starts again on return, only while on duty.
    globalThis.document?.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && keepAlive && keepAlive.paused && keepAliveWanted) void keepAlive.play().catch(() => {})
    })
  }
  void ctx.resume()
  return ctx
}

const RESUME_WAIT_MS = 500

/**
 * Whether Web Audio can sound now, trying to resume it first. A paused context plays nothing and never ends its
 * clips, so callers use the device voice instead of waiting on it.
 */
async function running(audio: AudioContext): Promise<boolean> {
  if (audio.state === 'running') return true
  await Promise.race([audio.resume().catch(() => {}), wait(RESUME_WAIT_MS)])
  // Read again: resume() changes it, which TypeScript can't see.
  return (audio.state as AudioContextState) === 'running'
}

function track(node: AudioScheduledSourceNode): void {
  sounding.add(node)
  node.addEventListener('ended', () => sounding.delete(node))
}

// Flagged requests get a different, rising three-note pattern (ANN-2).
const NOTES: Record<ChimeKind, number[]> = { normal: [659.3, 987.8], flagged: [784, 988, 1175] }
const NOTE_GAP = 0.2
const NOTE_LENGTH = 0.55

/** Plays the chime. Resolves true once it has sounded, false when the audio couldn't play (not unlocked, or paused). */
export function chime(kind: ChimeKind): Promise<boolean> {
  if (unlocking) return unlocking.then(() => chime(kind))
  if (!ctx) return Promise.resolve(false)
  if (ctx.state !== 'running') return running(ctx).then((ok) => (ok ? chime(kind) : false))
  const audio = ctx
  const start = audio.currentTime + 0.03
  NOTES[kind].forEach((freq, i) => {
    const t = start + i * NOTE_GAP
    const osc = audio.createOscillator()
    const gain = audio.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.4, t + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + NOTE_LENGTH)
    osc.connect(gain).connect(audio.destination)
    track(osc)
    osc.start(t)
    osc.stop(t + NOTE_LENGTH + 0.05)
  })
  return wait(((NOTES[kind].length - 1) * NOTE_GAP + NOTE_LENGTH + 0.15) * 1000).then(() => true)
}

/**
 * Plays one clip, unless a Stop came first. Resolves 'cut' when iOS takes the audio away mid-clip (a call, Siri, the
 * audio session handed back), since the clip then never sounds to its end; otherwise 'done' when it ends or is stopped.
 */
function play(buf: AudioBuffer, mine: number): Promise<'done' | 'cut'> {
  if (mine !== generation || !ctx) return Promise.resolve('done')
  const audio = ctx
  const src = audio.createBufferSource()
  src.buffer = buf
  src.connect(audio.destination)
  return new Promise((resolve) => {
    const end = (how: 'done' | 'cut') => {
      clearTimeout(guard)
      audio.removeEventListener?.('statechange', onState)
      resolve(how)
    }
    const onState = () => {
      if (audio.state === 'running') return
      sounding.delete(src)
      try { src.stop() } catch { /* already ended */ }
      end('cut')
    }
    // If the audio is paused mid-clip, 'ended' never fires; without this the gate queue would stop for good.
    const guard = setTimeout(() => end(audio.state === 'running' ? 'done' : 'cut'), buf.duration * 1000 + 1500)
    // The clip's own end is the proof it was heard: one that ends well before its length was cut short by the system,
    // not by Stop (which changes the generation, so the caller says nothing more either way).
    const startedAt = audio.currentTime
    src.addEventListener('ended', () => {
      const cut = mine === generation && audio.currentTime - startedAt < buf.duration - EARLY_END_S
      voiceLog(cut ? 'playback-cut' : 'playback-end', { seconds: secs(buf.duration), played: secs(audio.currentTime - startedAt) })
      end(cut ? 'cut' : 'done')
    })
    audio.addEventListener?.('statechange', onState)
    track(src)
    voiceLog('playback-start', { seconds: secs(buf.duration), state: audio.state })
    src.start()
  })
}

/**
 * Says an announcement (the words shown on screen; the child's approved pronunciation is applied only for the voice).
 * The opening ("New announcement.") plays as soon as it's ready, and the message, one continuous recording, follows
 * while the gate listens; whichever part isn't ready within CLIP_BUDGET_MS is said by the iPad's Indian English voice,
 * so the gate never waits. Never rejects.
 */
/**
 * Which voice said it: the school's clips, the device's own voice (all or part), a sentence that started but was cut
 * off before its end (not heard, so said again), or nothing at all.
 */
export type Spoken = 'school' | 'device' | 'cut' | 'silent'

/** Which voice the last announcement used, and why when it wasn't the school's: shown on the duty screen. */
export interface VoiceUsed { voice: Spoken; why: string | null; at: number }
const usedListeners = new Set<(v: VoiceUsed) => void>()
export function onVoiceUsed(fn: (v: VoiceUsed) => void): () => void {
  usedListeners.add(fn)
  return () => void usedListeners.delete(fn)
}
/** The reason in plain words, from the voice log's latest problem in the last 30 seconds. */
export function explainVoiceProblem(p: { stage: string; detail: Record<string, unknown>; at: number } | null, budgetMs: number, now = Date.now()): string {
  const fallback = `the school's voice didn't arrive within ${budgetMs / 1000} seconds`
  if (!p || now - p.at > 30_000) return fallback
  const reason = String(p.detail.reason ?? p.detail.status ?? '')
  if (p.stage === 'audio-paused') return 'this phone had paused its sound'
  if (p.stage === 'device-voice-unavailable') return 'this phone has no suitable voice installed'
  if (/paused|429/.test(reason)) return 'too many new recordings were asked for; the school voice is back within a minute'
  if (/signed out/.test(reason)) return 'this phone is signed out'
  if (/Timeout|abort|fetch|network|Load failed/i.test(reason)) return 'the connection to the voice service was too slow'
  if (/decod|EncodingError/i.test(reason)) return "this phone couldn't play the recording"
  if (/pronounce 5\d\d/.test(reason)) return 'the voice service had a problem'
  return fallback
}

export async function speak(text: string, childId?: string, budgetMs = CLIP_BUDGET_MS): Promise<Spoken> {
  const budget = budgetMs === CLIP_BUDGET_MS && speechSupported && !pickIndianVoice(speechSynthesis.getVoices()) ? NO_INDIAN_VOICE_BUDGET_MS : budgetMs
  const voice = await speakWith(text, childId, budget)
  const used: VoiceUsed = { voice, why: voice === 'school' ? null : explainVoiceProblem(lastVoiceProblem(), budget), at: Date.now() }
  usedListeners.forEach((fn) => fn(used))
  return voice
}

async function speakWith(text: string, childId: string | undefined, budgetMs: number): Promise<Spoken> {
  const parts = voiceParts(text, voiceChild(childId), openings)
  if (!parts.length) return 'silent'
  const mine = generation
  if (unlocking) await unlocking
  markVoice(text, 'chime-end')
  if (ctx) {
    const audio = ctx
    const clips = parts.map((part) => clipAudio(audio, part))
    // Still being made when the time runs out: kept for the 2-minute repeat.
    for (const clip of clips) clip.catch(() => {})
    // Paused by iOS: clips would play silently, so the tablet's voice says it (the clips stay ready for later).
    if (!(await running(audio))) {
      voiceLog('audio-paused', { state: audio.state })
      return speakDevice(parts.join(' '), mine)
    }
    for (const [i, clip] of clips.entries()) {
      if (i > 0) await wait(PART_GAP_MS)
      if (mine !== generation) return 'silent'
      const buf = await Promise.race([clip, wait(budgetMs).then(() => null)]).catch(() => null)
      if (mine !== generation) return 'silent'
      if (!buf) {
        markVoice(text, 'device-voice')
        voiceLog('school-voice-not-ready', { part: i, waitedMs: budgetMs })
        // One owner per announcement: the late clip is never played once the device voice has taken over.
        // The opening played but the child's name wasn't said: not heard, so the announcer tries again soon.
        return speakDevice(parts.slice(i).join(' '), mine)
      }
      markVoice(text, i === 0 ? 'speech-start' : 'message-start')
      // Cut off mid-sentence: say the whole sentence again once the audio is back, or in the tablet's voice if iOS
      // won't give it back. Never counted as played.
      if ((await play(buf, mine)) === 'cut' && mine === generation) {
        markVoice(text, 'cut')
        if (!(await running(audio)) || (await play(buf, mine)) === 'cut') {
          if (mine !== generation) return 'silent'
          return speakDevice(parts.slice(i).join(' '), mine)
        }
      }
      if (i === 0) markVoice(text, 'opening-end')
    }
    return mine === generation ? 'school' : 'silent'
  }
  markVoice(text, 'device-voice')
  return speakDevice(parts.join(' '), mine)
}

/** Starts getting an announcement's clips (from this iPad or the school's store) so speech starts without a pause. */
export function prepare(text: string, childId?: string): void {
  if (!ctx) return
  markVoice(text, 'prepare')
  for (const part of voiceParts(text, voiceChild(childId), openings)) void clipAudio(ctx, part).catch(() => {})
}

/** Copies a coming sentence's clips if the school already made them (the next reminder): never makes one live. */
export function warm(text: string, childId?: string): void {
  if (!ctx) return
  for (const part of voiceParts(text, voiceChild(childId), openings)) void storedClipAudio(ctx, part)
}

/**
 * Plays one sentence in the school's voice, waiting for it to be made if needed (a pronunciation preview, not the gate).
 * `onStart` runs the moment sound begins. Rejects when it can't be made, so the preview can say so.
 */
export async function playSentence(sentence: string, onStart?: () => void): Promise<void> {
  stopSound()
  const mine = generation
  const [line] = voiceParts(sentence)
  if (!line) return
  const clip = await clipAudio(audioContext(), line)
  if (mine !== generation) return
  onStart?.()
  if ((await play(clip, mine)) === 'cut' && mine === generation && (await running(audioContext()))) await play(clip, mine)
}

// The device's own voice, used only when the school's clip isn't ready: always an Indian English woman, like the gate
// voice. Never a man's voice or another accent; with none installed, the chime and the screen carry the announcement.
// Measured by recording each voice and transcribing it (2026-09-27): Apple's Tara garbled "Urgent. Reminder. Pickup
// for…", so it comes last. Isha (Settings → Accessibility → Spoken Content) is best on an iPad.
const FEMALE = /\b(isha|neerja|heera|lekha|veena|kajal|swara|aditi)\b/i
const PREFERRED = [
  new RegExp(`(${FEMALE.source}.*(natural|online|enhanced|premium))|((natural|online|enhanced|premium).*${FEMALE.source})`, 'i'),
  FEMALE,
]
const LAST = /\b(tara|siri)\b/i
export function pickIndianVoice<V extends Pick<SpeechSynthesisVoice, 'name' | 'lang'>>(all: readonly V[]): V | null {
  const voices = all.filter((v) => v.lang.replace('_', '-').toLowerCase() === 'en-in')
  for (const p of PREFERRED) {
    const v = voices.find((x) => p.test(x.name) && !LAST.test(x.name))
    if (v) return v
  }
  return voices.find((v) => LAST.test(v.name) && /\btara\b/i.test(v.name)) ?? null
}
/**
 * The device voice the gate may use: only an Indian English woman's, else none (owner, 2026-10-26: never a UK or US
 * accent, which says Indian names wrongly). With none, the chime plays, the screen shows it, and it is said again.
 */
export function pickFallbackVoice<V extends Pick<SpeechSynthesisVoice, 'name' | 'lang'>>(all: readonly V[]): V | null {
  return pickIndianVoice(all)
}
// Safari fills the voice list a moment after the page loads: ask early, so the Start duty tap can use it at once.
if (speechSupported) {
  speechSynthesis.getVoices()
  speechSynthesis.addEventListener?.('voiceschanged', () => speechSynthesis.getVoices())
}
async function fallbackVoice(): Promise<SpeechSynthesisVoice | null> {
  if (!speechSynthesis.getVoices().length) {
    await Promise.race([new Promise((r) => speechSynthesis.addEventListener('voiceschanged', r, { once: true })), wait(1000)])
  }
  const all = speechSynthesis.getVoices()
  const voice = pickFallbackVoice(all)
  if (!voice) voiceLog('device-voice-unavailable', { voices: all.length, indianEnglish: all.filter((v) => /^en[-_]in/i.test(v.lang)).map((v) => v.name) })
  return voice
}

async function speakDevice(text: string, mine: number): Promise<Spoken> {
  if (!speechSupported || mine !== generation) return 'silent'
  const voice = await fallbackVoice()
  if (!voice || mine !== generation) return 'silent'
  voiceLog('device-voice-start', { voice: voice.name, chars: text.length })
  return new Promise((resolve) => {
    let started = false
    const u = new SpeechSynthesisUtterance(text)
    u.voice = voice
    u.lang = voice.lang
    // A touch slower than default, at natural pitch: clearer across a noisy gate without sounding drawn out.
    u.rate = 0.95
    let done = false
    // An error after the voice started (iOS took the audio away) means the sentence didn't reach its end.
    let broken = false
    const finish = () => {
      if (done) return
      done = true
      clearTimeout(fallback)
      if (utterance === u) utterance = null
      if (endDevice === finish) endDevice = null
      const how = !started ? 'silent' : broken && mine === generation ? 'cut' : 'device'
      voiceLog(how === 'device' ? 'device-voice-end' : 'device-voice-failed', { how })
      resolve(how)
    }
    // ponytail: Safari occasionally never fires onend; a length-based timeout keeps the queue moving.
    const fallback = setTimeout(finish, 4000 + text.length * 90)
    // onstart is the proof the voice really spoke: a blocked voice can end at once without a sound.
    u.onstart = () => { started = true }
    u.onend = finish
    u.onerror = () => { broken = true; finish() }
    utterance = u
    endDevice = finish
    speechSynthesis.speak(u)
  })
}

/** Silences everything at once: chime, voice clip, device voice, and anything still on its way. */
export function stopSound(): void {
  generation += 1
  for (const node of sounding) {
    try { node.stop() } catch { /* not started or already ended */ }
  }
  sounding.clear()
  if (speechSupported) speechSynthesis.cancel()
  endDevice?.()
}

export const deviceOutput: AnnouncerOutput = { chime, speak, stop: stopSound, prepare, warm }
