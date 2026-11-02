import { Link } from 'react-router'
import { ChartColumn } from 'lucide-react'
import { useOnline } from '../../ui/hooks'
import { AccountButton } from '../auth/AreaShell'
import { OnDuty } from './OnDuty'
import { StartDuty } from './StartDuty'
import { useDuty } from './useDuty'
import { ErrorState, SkeletonList } from '../../ui/States'

/** The coordinator's iPad: Start duty, then the on-duty screen. Loaded only when a coordinator opens it. */
export default function CoordinatorDuty() {
  const duty = useDuty()
  const online = useOnline()
  // Active or paused, the duty screen opens straight away: coming back to the app never asks to resume.
  if (duty.phase === 'on' || duty.phase === 'paused') return <OnDuty duty={duty} online={online} />
  if (duty.loadFailed) return <div className="gutter grid min-h-dvh place-items-center"><ErrorState title="Can't check your duty" onRetry={duty.retry}>Jumpstart Go couldn't reach the school. Your duty hasn't changed. Check the connection and try again.</ErrorState></div>
  if (duty.phase === 'loading') return <div className="gutter grid min-h-dvh place-items-center" aria-busy="true"><SkeletonList count={3} className="grid w-full max-w-[760px] gap-3" /></div>
  return (
    <>
      <div className="fixed right-[max(16px,env(safe-area-inset-right))] top-[max(16px,env(safe-area-inset-top))] z-20 flex items-center gap-2">
        <Link to="/coordinator/reports" className="account-pill flex h-11 items-center gap-2 rounded-full px-3.5 text-small font-bold"><ChartColumn className="size-5" aria-hidden />Attendance</Link>
        <AccountButton area="coordinator" />
      </div>
      <StartDuty duty={duty} online={online} />
    </>
  )
}
