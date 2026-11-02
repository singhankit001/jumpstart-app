import { useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { BellRing, CalendarClock, Check, ChevronDown, ChevronRight, Clock, Headset, Megaphone, MessageSquare, ScrollText, Settings, ShieldCheck, UserRound, UsersRound, WifiOff } from '../../ui/icons'
import { ChartColumn } from 'lucide-react'
import { Avatar } from '../../ui/Avatar'
import { Logo } from '../../ui/Logo'
import { Sheet } from '../../ui/Sheet'
import { useOnline } from '../../ui/hooks'
import { SignOutButton } from '../../ui/SignOutButton'
import { areasFor, useSession, type Area, type StaffRole } from './session'
import { PARENT_PAGES, ParentTabBar, ParentTopNav } from '../family/ParentNav'
import { PushSwitch } from '../notifications/PushSwitch'
import { ImportBanner } from '../admin/ImportBanner'
import { CountBadge } from '../../ui/CountBadge'
import { useUnread } from '../notifications/Unread'

export const AREA_LABEL: Record<Area, string> = { admin: 'Admin', core: 'Head office', pro: 'Front desk', coordinator: 'Center coordinator', parent: 'Parent' }
/** Roles are told apart by icon, never by colour alone (owner, 2026-09-24). Same icons as the Screen Book. */
export const AREA_ICON: Record<Area, ReactNode> = { admin: <ShieldCheck />, core: <CalendarClock />, pro: <Headset />, coordinator: <BellRing />, parent: <UserRound /> }
/** What each area gives access to, shown when choosing where to start. */
export const AREA_DOES: Record<Area, string> = {
  admin: 'Everything, including people and roles',
  core: 'Timings, attendance and the gate team',
  pro: 'Calls, messages and announcements',
  coordinator: 'The gate: announcements, check-ins and handovers',
  parent: 'Your own children',
}

/** The gate area is one area for two roles: someone who is only a Center Leader sees it named and described as theirs. */
const leaderOnly = (a: Area, roles: readonly StaffRole[]) => a === 'coordinator' && !roles.includes('coordinator')
export const areaLabel = (a: Area, roles: readonly StaffRole[]) => (leaderOnly(a, roles) ? 'Center leader' : AREA_LABEL[a])
export const areaDoes = (a: Area, roles: readonly StaffRole[]) => (leaderOnly(a, roles) ? 'The gate: hear requests, acknowledge and mark Ready' : AREA_DOES[a])

/** Pages inside an area, shown as tabs under the top bar. */
const AREA_PAGES: Partial<Record<Area, Array<{ to: string; label: string; short?: string; icon: ReactNode }>>> = {
  admin: [
    { to: '/admin', label: 'People', icon: <UsersRound /> },
    { to: '/admin/coordinators', label: 'Gate team', short: 'Gate', icon: <BellRing /> },
    { to: '/admin/announce', label: 'Announce', short: 'News', icon: <Megaphone /> },
    { to: '/admin/reports', label: 'Attendance & Reports', short: 'Reports', icon: <ChartColumn /> },
    { to: '/admin/settings', label: 'Settings', icon: <Settings /> },
    { to: '/admin/audit', label: 'Audit log', short: 'Audit', icon: <ScrollText /> },
  ],
  core: [
    { to: '/core', label: 'Today', icon: <CalendarClock /> },
    { to: '/core/schedules', label: 'Schedules', short: 'Times', icon: <Clock /> },
    { to: '/core/coordinators', label: 'Gate team', short: 'Gate', icon: <BellRing /> },
    { to: '/core/messages', label: 'Messages', icon: <MessageSquare /> },
    { to: '/core/announce', label: 'Announce', short: 'News', icon: <Megaphone /> },
    { to: '/core/reports', label: 'Attendance & Reports', short: 'Reports', icon: <ChartColumn /> },
  ],
  parent: PARENT_PAGES,
  // The duty screen has its own full-screen layout; these tabs show on the attendance page, to get back to the gate.
  coordinator: [
    { to: '/coordinator', label: 'Gate', icon: <BellRing /> },
    { to: '/coordinator/reports', label: 'Attendance', icon: <ChartColumn /> },
  ],
  pro: [
    { to: '/pro', label: 'Front desk', icon: <Headset /> },
    { to: '/pro/messages', label: 'Messages', icon: <MessageSquare /> },
    { to: '/pro/announce', label: 'Announce', icon: <Megaphone /> },
  ],
}

/** The dark area label in the top bar: which part of the app this is, with its icon. */
/** The area's name for whoever is signed in: a leader-only user sees "Center leader", not "Center coordinator". */
function useAreaLabel(area: Area): string {
  const { state } = useSession()
  return state.status === 'signed-in' && state.me ? areaLabel(area, state.me.roles) : AREA_LABEL[area]
}

export function AreaChip({ area }: { area: Area }) {
  const label = useAreaLabel(area)
  // "Center coordinator" and "Center leader" need more room than the other labels before they fit beside the account button.
  const narrow = label.length > 12 ? 'max-[419px]' : 'max-[374px]'
  return (
    <span className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-secondary pl-2.5 pr-3 text-caption font-extrabold text-canvas shadow-[0_2px_0_var(--secondary-lip)] [&_svg]:size-4 ${narrow === 'max-[419px]' ? 'max-[419px]:pr-2.5' : 'max-[374px]:pr-2.5'}`} aria-label={label}>
      {AREA_ICON[area]}
      <span className={narrow === 'max-[419px]' ? 'max-[419px]:hidden' : 'max-[374px]:hidden'}>{label}</span>
    </span>
  )
}

/** Signed-in person's button: shows who is signed in, switches area (D16) and signs out. */
export function AccountButton({ area }: { area: Area }) {
  const { state, signOut } = useSession()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  if (state.status !== 'signed-in' || !state.me) return null
  const me = state.me
  const areas = areasFor(me)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-label={`Account: ${me.full_name}`}
        className="account-pill flex h-11 shrink-0 items-center gap-2 rounded-full p-1 pr-2.5 text-small font-bold sm:pr-3.5">
        <Avatar name={me.full_name} color="var(--accent)" size="xs" />
        <span className="hidden sm:inline">{me.full_name.split(' ')[0]}</span>
        <ChevronDown className="size-4 text-ink-3" aria-hidden />
      </button>
      <Sheet fade open={open} onClose={() => setOpen(false)} title={me.full_name} description={`Signed in as ${areaLabel(area, me.roles)}`}>
        {areas.length > 1 && (
          <>
            <p className="kicker">Switch area</p>
            <div className="lux-panel mt-2 grid gap-3 sm:grid-cols-2">
              {areas.map((a) => (
                <button key={a} type="button" className="lux lux-tile gap-3.5" aria-pressed={a === area}
                  onClick={() => { setOpen(false); if (a !== area) navigate(`/${a}`) }}>
                  <span className="lux__icon" aria-hidden>{AREA_ICON[a]}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-h4">{areaLabel(a, me.roles)}</span>
                    <span className="block text-caption font-semibold text-ink-2">{a === area ? 'You are here' : areaDoes(a, me.roles)}</span>
                  </span>
                  {a === area ? <Check className="size-5 shrink-0 text-accent" aria-hidden /> : <ChevronRight className="size-5 shrink-0 text-ink-3" aria-hidden />}
                </button>
              ))}
            </div>
          </>
        )}
        {area !== 'parent' && <div className="mt-4 rounded-lg bg-sunken px-3.5"><PushSwitch /></div>}
        <SignOutButton className="mt-6" onClick={() => void signOut()} />
      </Sheet>
    </>
  )
}

/** Shown under the top bar while the device is offline, so a failed save is never a surprise. */
export function OfflineNotice() {
  const online = useOnline()
  if (online) return null
  return (
    <div role="status" className="mx-auto mt-3 flex max-w-[var(--content)] items-center gap-2.5 rounded-md bg-warning-soft px-4 py-3 text-small font-bold text-warning [&>svg]:size-[18px] [&>svg]:shrink-0">
      <WifiOff aria-hidden />
      You're offline. What's on screen may be out of date, and changes can't be saved until you're back online.
    </div>
  )
}

/**
 * Page frame for the admin, core team and parent areas: a floating top bar (logo, area, account), the area's
 * page tabs, then the page title with its optional description and actions.
 */
export function AreaShell({ area, title, subtitle, actions, children }: { area: Area; title: string; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  const pages = AREA_PAGES[area]
  const label = useAreaLabel(area)
  // Unread on each tab (D57): a family's messages and announcements; the office's families' messages.
  const unread = useUnread()
  const count = (to: string) => (area === 'parent'
    ? (to.endsWith('/updates') ? unread.announcements : to.endsWith('/messages') ? unread.familyMessages : 0)
    : to.endsWith('/messages') ? unread.officeMessages : 0)
  const { pathname } = useLocation()
  // An area's first page stays selected on the pages it opens (a child's page under People, a parent's conversation).
  const isActive = (to: string) => pathname === to || (to === `/${area}` ? pathname.startsWith(`/${area}/child/`) : pathname.startsWith(`${to}/`))
  return (
    <div className="min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-[max(12px,env(safe-area-inset-top))] focus:z-50 focus:rounded-sm focus:bg-surface focus:px-4 focus:py-3 focus:font-bold focus:shadow-float">
        Skip to content
      </a>
      <header className="gutter sticky top-0 z-30 pt-[max(12px,env(safe-area-inset-top))]">
        <div className="glass mx-auto flex h-16 max-w-[var(--content)] items-center gap-3 rounded-xl pl-4 pr-2.5 sm:gap-4 sm:pl-5">
          <Logo className="h-7 sm:h-8" />
          <span className="h-6 w-px bg-line-2 max-[359px]:hidden" aria-hidden />
          <AreaChip area={area} />
          <div className="flex min-w-0 flex-1 justify-center">
            {area === 'parent' ? <ParentTopNav /> : pages && (
              <nav aria-label={`${label} pages`} className={`topnav ${pages.length > 3 ? 'max-xl:hidden' : 'max-lg:hidden'}`}>
                {pages.map((page) => <Link key={page.to} to={page.to} aria-current={isActive(page.to) ? 'page' : undefined}>{page.icon}{page.label}<CountBadge n={count(page.to)} /></Link>)}
              </nav>
            )}
          </div>
          <AccountButton area={area} />
        </div>
        <OfflineNotice />
      </header>
      <main id="main" className={`gutter mx-auto w-full max-w-[calc(var(--content)+2*var(--gutter))] pb-[max(40px,env(safe-area-inset-bottom))] pt-6 ${pages ? 'max-md:pb-[calc(104px+env(safe-area-inset-bottom))]' : ''}`}>
        {pages && (
          // Under the top bar on tablets; in the top bar itself on wide screens; parents use the bottom bar on phones.
          <nav aria-label={`${label} pages`} className={`topnav mb-6 w-fit max-w-full overflow-x-auto [scrollbar-width:none] ${area === 'parent' ? 'max-md:hidden lg:hidden' : pages.length > 3 ? 'max-md:hidden xl:hidden' : 'max-md:hidden lg:hidden'}`}>
            {pages.map((page) => <Link key={page.to} to={page.to} aria-current={isActive(page.to) ? 'page' : undefined}>{page.icon}{page.label}<CountBadge n={count(page.to)} /></Link>)}
          </nav>
        )}
        <div className="page-in">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
            <div className="min-w-0">
              <h1 className="text-h1">{title}</h1>
              {subtitle && <p className="mt-2 max-w-[68ch] text-lead text-ink-2">{subtitle}</p>}
            </div>
            {actions && <div className="flex flex-wrap gap-2.5 max-sm:w-full max-sm:[&>*]:min-w-[140px] max-sm:[&>*]:flex-1">{actions}</div>}
          </div>
          {children}
        </div>
      </main>
      {area === 'parent' ? <ParentTabBar /> : (
        <>
          <ImportBanner />
          {pages && (
            // Phones: the area's pages as a glass tab bar at the thumb, the same as the parent's.
            <nav aria-label={`${label} pages`} className="glass fixed inset-x-3 bottom-[max(10px,env(safe-area-inset-bottom))] z-40 mx-auto grid max-w-[520px] rounded-[26px] p-1.5 md:hidden"
              style={{ gridTemplateColumns: `repeat(${pages.length}, minmax(0, 1fr))` }}>
              {pages.map((page) => {
                const active = isActive(page.to)
                return (
                  <Link key={page.to} to={page.to} aria-current={active ? 'page' : undefined} aria-label={count(page.to) ? `${page.label}, ${count(page.to)} new` : page.label}
                    className={`relative grid h-14 min-w-0 place-items-center content-center gap-0.5 rounded-[20px] px-0.5 text-[11.5px] font-bold transition-colors duration-150 [&_svg]:size-[22px] ${active ? 'bg-surface text-accent-ink shadow-[0_2px_0_var(--line-2)]' : 'text-ink-2'}`}>
                    {page.icon}
                    <span className="max-w-full truncate">{page.short ?? page.label}</span>
                    <CountBadge n={count(page.to)} corner />
                  </Link>
                )
              })}
            </nav>
          )}
        </>
      )}
    </div>
  )
}
