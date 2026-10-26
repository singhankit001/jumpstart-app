// Web push for Jumpstart Go (loaded into the app's service worker). Shows what push-send sends; a tap opens that page.

// The number on the installed app's icon while it's closed, like WhatsApp: how many notifications are waiting. The open
// app sets the exact unread count itself (notifications/Unread.tsx). Not every device supports it; that's fine.
async function syncBadge() {
  try {
    const n = (await self.registration.getNotifications()).length
    if (n > 0) await self.navigator.setAppBadge?.(n)
    else await self.navigator.clearAppBadge?.()
  } catch { /* no badge on this device */ }
}

// A path on this site only: what the browser would really open must stay on this origin ("/\\evil" and "/\t/evil" don't).
function samePath(u) {
  if (typeof u !== 'string' || !u.startsWith('/')) return false
  try { return new URL(u, self.location.origin).origin === self.location.origin } catch { return false }
}

// What each open duty screen says it is announcing right now (GateQueue posts it): window id → trips it speaks aloud.
// Lost if the worker restarts, which means "not announcing": alerts then sound, the safe side.
const announcing = new Map()
self.addEventListener('message', (event) => {
  const m = event.data
  if (!m || m.type !== 'jumpstart-announcing' || !event.source) return
  if (m.on && Array.isArray(m.trips)) announcing.set(event.source.id, new Set(m.trips.filter((t) => typeof t === 'string')))
  else announcing.delete(event.source.id)
})

// A gate alert opens that request on the duty screen (GateQueue reads ?trip=).
function pageFor(d) {
  const url = samePath(d.url) ? d.url : '/'
  const trip = typeof d.tag === 'string' && /^trip-[0-9a-f-]{36}$/i.test(d.tag) ? d.tag.slice(5) : null
  return trip && url.split('?')[0] === '/coordinator' ? `/coordinator?trip=${trip}` : url
}

// Tells the school this device displayed or opened the alert (0059). Text body, no credentials: no CORS preflight, and
// the receipt in the payload is the only proof needed. A failed report never affects the notification.
function report(data, event) {
  if (!data || typeof data.ack !== 'string' || !data.ack.startsWith('https://') || typeof data.id !== 'number' || typeof data.receipt !== 'string') return Promise.resolve()
  return fetch(data.ack, { method: 'POST', mode: 'no-cors', keepalive: true, body: JSON.stringify({ id: data.id, receipt: data.receipt, event }) }).catch(() => {})
}

// An open window reads its data afresh at once, in case its live connection died while the device slept.
async function tellWindows(message) {
  const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  for (const c of open) c.postMessage(message)
}

self.addEventListener('push', (event) => {
  let d = {}
  try { d = event.data ? event.data.json() : {} } catch { d = { body: event.data ? event.data.text() : '' } }
  // A gate alert stays on screen until someone acts on it, and buzzes in a pattern that is hard to sleep through.
  const gate = typeof d.tag === 'string' && (d.tag.startsWith('trip-') || d.tag.startsWith('duty-'))
  const data = { url: pageFor(d), id: d.id, receipt: d.receipt, ack: d.ack }
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    // A duty screen in front of someone says it is announcing this very request with its sound on: the alert shows
    // without its own sound, so the two don't play over each other. Anything else always sounds: a test, a duty- alert,
    // a request that screen isn't announcing (another class, muted, sound paused, not on duty yet).
    const trip = typeof d.tag === 'string' && d.tag.startsWith('trip-') ? d.tag.slice(5) : null
    const watching = !!trip && open.some((c) => c.focused && c.visibilityState === 'visible' && announcing.get(c.id)?.has(trip))
    await self.registration.showNotification(d.title || 'Jumpstart Go', {
      body: d.body || '',
      ...(gate ? { requireInteraction: true } : {}),
      // Browsers refuse vibrate together with silent.
      ...(watching ? { silent: true } : gate ? { vibrate: [300, 150, 300, 150, 600] } : {}),
      tag: d.tag,
      renotify: Boolean(d.tag),
      data,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
    })
    await Promise.all([syncBadge(), report(data, 'displayed'), tellWindows({ type: 'jumpstart-push', tag: d.tag ?? null })])
  })())
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification.data ?? {}
  const url = new URL(samePath(data.url) ? data.url : '/', self.location.origin)
  event.waitUntil((async () => {
    await Promise.all([syncBadge(), report(data, 'opened')])
    const open = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).filter((c) => c.url.startsWith(self.location.origin))
    const path = (c) => new URL(c.url).pathname
    const duty = (c) => path(c).startsWith('/coordinator')
    // The window already on that page, else a duty screen, else any.
    const win = open.find((c) => path(c) === url.pathname) ?? open.find(duty) ?? open[0]
    if (win) {
      await win.focus()
      // Never reload a duty screen (or a page for "just open the app"): a reload ends the duty session and its sound until
      // someone taps Resume, and loses a test in progress. It shows the request itself (GateQueue reads jumpstart-open).
      if (path(win) === url.pathname || duty(win) || url.pathname === '/') win.postMessage({ type: 'jumpstart-open', url: url.pathname + url.search })
      else if ('navigate' in win) await win.navigate(url.href)
      return
    }
    await self.clients.openWindow(url.href)
  })())
})

// The push service rotated or expired this device's subscription: subscribe again with the same key. The app saves it
// for the signed-in person the next time PushSwitch checks (pushState), since the worker has no sign-in of its own.
self.addEventListener('pushsubscriptionchange', (event) => {
  const key = event.oldSubscription?.options?.applicationServerKey
  if (!key) return
  event.waitUntil(self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }).catch(() => {}))
})
