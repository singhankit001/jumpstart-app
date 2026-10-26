/**
 * The gate's announcement queue (ANN-1, ANN-2): one announcement at a time, most urgent first, a chime then speech,
 * repeated every reminder interval (the admin's setting, 0042) until acknowledged. Muting holds the queue; nothing is
 * dropped. The first time something is said it starts with the new or urgent opening; each repeat starts with the
 * reminder opening, so the gate can tell a new request from one it has already heard. The words are made at the moment
 * they are spoken, so a reminder says the time left now. Output is injected so the queue can be tested without a speaker.
 */
import { DEFAULT_GATE } from '../../../supabase/functions/_shared/gateAnnounce.ts'
import { REMINDER_PENALTY } from '../../../supabase/functions/_shared/gateTrip.ts'

export type ChimeKind = 'normal' | 'flagged'

export interface Openings { new: string; urgent: string; reminder: string }

export interface Announcement {
  /** Stable id, e.g. "trip:123". Announcing the same id again replaces it. */
  id: string
  /** The message after the opening, or how to make it at the moment it's spoken (a reminder's time left). */
  text: string | (() => string)
  /** The first time only, these words instead, with no opening: a running-late update says its own "Pickup update." */
  first?: () => string
  chime: ChimeKind
  priority: number
  /** The child it's about: the voice says their name the way the school approved. */
  childId?: string
  /** Said with the urgent opening and shown in red: outside the usual time, or someone arriving within minutes. */
  urgent?: boolean
  /** Within one priority, lower goes first: the trip's arrival time. */
  order?: number
  /** Said once, then gone (a cancellation): never repeated, and kept through a mute until it has been heard. */
  once?: boolean
}

export interface AnnouncerOutput {
  chime(kind: ChimeKind): Promise<unknown>
  speak(text: string, childId?: string): Promise<unknown>
  /** Cut the current speech short (someone has already handled it, or Mute). */
  stop?(): void
  /** Get the words' audio ready while the chime plays, so speech starts the moment it ends. */
  prepare?(text: string, childId?: string): void
  /** Get a later message ready only from clips already made: looking ahead never makes one live. */
  warm?(text: string, childId?: string): void
  /** It was said in full on this device (the school's voice or the device's own), not cut off, muted or silent. */
  heard?(id: string): void
}

export interface AnnouncerState {
  speaking: Announcement | null
  waiting: number
  mutedUntil: number | null
}

// When nothing sounded, the announcement is tried again this soon rather than after a full reminder interval.
const SILENT_RETRY_MS = 15_000
export const REPEAT_MS = DEFAULT_GATE.reminder_min * 60_000

interface Item extends Announcement {
  seq: number
  dueAt: number
  /** Said in full at least once (a sentence cut off by Mute doesn't count). */
  heard: boolean
}

/** Before the item is next said, reminders sort after every new announcement. */
const rank = (i: Item) => i.priority - (i.heard ? REMINDER_PENALTY : 0)

export function createAnnouncer(output: AnnouncerOutput, repeatMs = REPEAT_MS) {
  // The words actually spoken for an item, made now: the message alone, with no opening before it.
  const spokenFor = (item: Pick<Item, 'text' | 'heard' | 'first'>): string =>
    !item.heard && item.first ? item.first() : typeof item.text === 'function' ? item.text() : item.text
  const items = new Map<string, Item>()
  const listeners = new Set<(s: AnnouncerState) => void>()
  let seq = 0
  let playing: Item | null = null
  let mutedUntil = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  // Announcements that arrive together (Start duty, a reconnect) are all queued before the first plays, so the most
  // urgent and earliest goes first rather than whichever happened to be announced first.
  let scheduled = false
  const soon = () => {
    if (scheduled) return
    scheduled = true
    queueMicrotask(() => { scheduled = false; void pump() })
  }

  const state = (): AnnouncerState => ({
    speaking: playing,
    waiting: items.size - (playing && items.has(playing.id) ? 1 : 0),
    mutedUntil: mutedUntil > Date.now() ? mutedUntil : null,
  })
  const emit = () => listeners.forEach((fn) => fn(state()))

  const wakeAt = (at: number) => {
    clearTimeout(timer)
    // Timers over 2^31 - 1 ms (24.8 days, a Pause's hold) fire at once: wake at most that far ahead and check again.
    timer = setTimeout(pump, Math.min(2 ** 31 - 1, Math.max(0, at - Date.now())))
  }

  async function pump(): Promise<void> {
    if (playing) return emit()
    clearTimeout(timer)
    const now = Date.now()
    if (now < mutedUntil) {
      wakeAt(mutedUntil)
      return emit()
    }
    let next: Item | undefined
    let soonest = Infinity
    for (const item of items.values()) {
      if (item.dueAt > now) soonest = Math.min(soonest, item.dueAt)
      else if (!next || rank(item) > rank(next) || (rank(item) === rank(next) && ((item.order ?? 0) - (next.order ?? 0) || item.seq - next.seq) < 0)) next = item
    }
    if (!next) {
      if (soonest < Infinity) wakeAt(soonest)
      return emit()
    }

    playing = next
    let silent = false
    emit()
    try {
      await output.chime(next.chime)
      // Muted during the chime: say nothing now; it plays when the mute ends.
      if (items.get(next.id) === next && Date.now() >= mutedUntil) {
        const spoken = await output.speak(spokenFor(next), next.childId)
        // Nothing sounded (no clip, audio paused, no device voice), or it was cut off mid-sentence: not heard, so try again
        // soon, still as new.
        if ((spoken === 'silent' || spoken === 'cut') && items.get(next.id) === next) silent = true
        // Heard unless Mute or an acknowledgement cut it short.
        else if (items.get(next.id) === next && Date.now() >= mutedUntil) {
          next.heard = true
          output.heard?.(next.id)
          if (next.once) items.delete(next.id)
          else output.prepare?.(spokenFor(next), next.childId)
        }
      }
    } catch {
      // A failed chime or voice must never stall the gate; the item repeats as usual.
    } finally {
      // Cut off by Mute: it wasn't heard, so it plays as soon as the mute ends rather than in 2 minutes.
      if (items.get(next.id) === next) next.dueAt = Date.now() < mutedUntil ? mutedUntil : Date.now() + (silent ? SILENT_RETRY_MS : repeatMs)
      playing = null
      void pump()
    }
  }

  return {
    /** The admin's reminder interval (0042). Openings are accepted but never said: the gate says the message alone. */
    configure(c: { openings?: Openings; repeatMs?: number }) {
      if (c.repeatMs) repeatMs = c.repeatMs
    },
    /** Gets an upcoming message's audio ready (a reminder's next time), so it plays without a pause. */
    warm(text: string, childId?: string) {
      output.warm?.(text, childId)
    },
    announce(a: Announcement) {
      const existing = items.get(a.id)
      // Announcing again (the trip changed) makes it new again: it's news the gate hasn't heard.
      const item = { ...a, seq: existing?.seq ?? seq++, dueAt: Date.now(), heard: false }
      items.set(a.id, item)
      // Replaced while being said (a new time, a new stage): the sentence finishes, never cut midway, and the new words
      // play straight after it. Only Mute, an acknowledgement and End duty stop speech.
      output.prepare?.(spokenFor(item), item.childId)
      soon()
    },
    /** Someone acknowledged it (on any iPad): stop repeating. */
    acknowledge(id: string) {
      items.delete(id)
      // If it's being said right now, stop: the gate has already dealt with it.
      if (playing?.id === id) output.stop?.()
      emit()
    },
    /**
     * This phone's own announcer (the Android app's GateVoice) just said it in full while this page couldn't: count it as
     * heard here, so the page says it next as a reminder at the usual interval, not again at once.
     */
    heardElsewhere(id: string) {
      const item = items.get(id)
      if (!item || playing?.id === id) return
      item.heard = true
      item.dueAt = Date.now() + repeatMs
      if (item.once) items.delete(id)
      void pump()
    },
    /** Silence now and hold announcements for `ms`. Whatever was cut off plays first when the mute ends. */
    mute(ms: number) {
      mutedUntil = Date.now() + ms
      if (playing) output.stop?.()
      void pump()
    },
    unmute() {
      mutedUntil = 0
      void pump()
    },
    clear() {
      items.clear()
      mutedUntil = 0
      clearTimeout(timer)
      emit()
    },
    subscribe(fn: (s: AnnouncerState) => void) {
      listeners.add(fn)
      fn(state())
      return () => void listeners.delete(fn)
    },
  }
}

export type Announcer = ReturnType<typeof createAnnouncer>
