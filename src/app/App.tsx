import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { ToastProvider } from '../ui/Toast'
import { SessionProvider } from '../features/auth/session'
import { ErrorBoundary } from '../ui/ErrorBoundary'
import { AreaRoute, Splash } from '../features/auth/AreaRoute'
import { CoreHome, ParentHome } from '../features/family/FamilyHomes'
import { UpdatePrompt } from './UpdatePrompt'
import { UnreadProvider } from '../features/notifications/Unread'

// Each staff area loads on first use, so a parent's phone never downloads the admin or iPad duty screens.
const AdminPeople = lazy(() => import('../features/admin/AdminPeople').then((m) => ({ default: m.AdminPeople })))
const AdminSettings = lazy(() => import('../features/admin/AdminSettings').then((m) => ({ default: m.AdminSettings })))
const AuditLog = lazy(() => import('../features/admin/AuditLog').then((m) => ({ default: m.AuditLog })))
// The reports and their file makers (PDF, Excel, Word) load only when staff open them.
const ReportsPage = lazy(() => import('../features/reports/ReportsPage').then((m) => ({ default: m.ReportsPage })))
const PrivacyPage = lazy(() => import('../features/legal/LegalPage').then((m) => ({ default: m.PrivacyPage })))
const TermsPage = lazy(() => import('../features/legal/LegalPage').then((m) => ({ default: m.TermsPage })))
const Schedules = lazy(() => import('../features/school/Schedules').then((m) => ({ default: m.Schedules })))
const FrontDesk = lazy(() => import('../features/school/FrontDesk').then((m) => ({ default: m.FrontDesk })))
const OfficeMessages = lazy(() => import('../features/school/Messages').then((m) => ({ default: m.OfficeMessages })))
const Announce = lazy(() => import('../features/school/Announce').then((m) => ({ default: m.Announce })))
const ParentUpdates = lazy(() => import('../features/family/ParentPages').then((m) => ({ default: m.ParentUpdates })))
const ParentMessages = lazy(() => import('../features/family/ParentPages').then((m) => ({ default: m.ParentMessages })))
const ParentAccount = lazy(() => import('../features/family/ParentPages').then((m) => ({ default: m.ParentAccount })))
const CoordinatorsPage = lazy(() => import('../features/coordinators/CoordinatorsPage').then((m) => ({ default: m.CoordinatorsPage })))
const CoordinatorDuty = lazy(() => import('../features/duty/CoordinatorDuty'))
// The page a person collecting opens from WhatsApp: no sign-in, so it loads nothing else.
const CollectorLink = lazy(() => import('../features/link/CollectorLink'))

/** The pages inside the admin, core and front desk areas (the tabs in AreaShell). */
function AreaPages({ area, index }: { area: 'admin' | 'core' | 'pro'; index: ReactNode }) {
  return (
    <Routes>
      <Route index element={index} />
      {area === 'admin' && <Route path="child/:childId" element={index} />}
      {area === 'admin' && <Route path="settings" element={<AdminSettings />} />}
      {area === 'admin' && <Route path="audit" element={<AuditLog />} />}
      {area === 'core' && <Route path="schedules" element={<Schedules />} />}
      {area !== 'pro' && <Route path="reports" element={<ReportsPage area={area} />} />}
      {area !== 'admin' && <Route path="messages" element={<OfficeMessages area={area} />} />}
      <Route path="announce" element={<Announce area={area} />} />
      {area !== 'pro' && <Route path="coordinators" element={<CoordinatorsPage area={area} />} />}
      <Route path="*" element={<Navigate to={`/${area}`} replace />} />
    </Routes>
  )
}

/** The parent's pages (Today loads with the app; the others on first use). */
function ParentPages() {
  return (
    <Routes>
      <Route index element={<ParentHome />} />
      <Route path="updates" element={<ParentUpdates />} />
      <Route path="messages" element={<ParentMessages />} />
      <Route path="messages/:childId" element={<ParentMessages />} />
      <Route path="account" element={<ParentAccount />} />
      <Route path="*" element={<Navigate to="/parent" replace />} />
    </Routes>
  )
}

export function App() {
  return (
    <SessionProvider>
      <ToastProvider>
        <BrowserRouter>
          <UnreadProvider>
          <ErrorBoundary>
          <Suspense fallback={<Splash />}>
            <Routes>
              <Route path="/privacy" element={<PrivacyPage />} />
              <Route path="/terms" element={<TermsPage />} />
              <Route path="/admin/*" element={<AreaRoute area="admin"><AreaPages index={<AdminPeople />} area="admin" /></AreaRoute>} />
              <Route path="/core/*" element={<AreaRoute area="core"><AreaPages index={<CoreHome />} area="core" /></AreaRoute>} />
              <Route path="/pro/*" element={<AreaRoute area="pro"><AreaPages index={<FrontDesk />} area="pro" /></AreaRoute>} />
              <Route path="/coordinator/*" element={<AreaRoute area="coordinator"><Routes><Route path="reports" element={<ReportsPage area="coordinator" />} /><Route path="*" element={<CoordinatorDuty />} /></Routes></AreaRoute>} />
              <Route path="/parent/*" element={<AreaRoute area="parent"><ParentPages /></AreaRoute>} />
              <Route path="/t/:token" element={<CollectorLink />} />
              {/* Anything else: the login screen, or the person's home area once signed in. */}
              <Route path="*" element={<AreaRoute area={null}>{null}</AreaRoute>} />
            </Routes>
          </Suspense>
          </ErrorBoundary>
          </UnreadProvider>
        </BrowserRouter>
        <UpdatePrompt />
      </ToastProvider>
    </SessionProvider>
  )
}
