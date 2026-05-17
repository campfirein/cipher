/**
 * Tour host
 *
 * Mounted once at the layout level. Renders surfaces fully owned by the tour
 * FSM — currently the connector step. Curate/query steps don't auto-mount
 * the composer; `useTourWatchers` routes the user to `/tasks` where the
 * empty-state coachmark guides them to click "New task" themselves.
 */

import {useOnboardingStore} from '../stores/onboarding-store'
import {ConnectorStep} from './connector-step'

export function TourHost() {
  const tourActive = useOnboardingStore((s) => s.tourActive)
  const tourStep = useOnboardingStore((s) => s.tourStep)

  if (!tourActive || !tourStep) return null

  return (
    <>
      <ConnectorStep />
    </>
  )
}
