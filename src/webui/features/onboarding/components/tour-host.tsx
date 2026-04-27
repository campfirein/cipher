/**
 * Tour host
 *
 * Mounted once at the layout level. Renders surfaces that are *fully owned*
 * by the tour FSM — the provider dialog (step 1) and the connector step
 * (step 4). Steps 2/3 (curate/query) intentionally do not auto-mount the
 * composer here: `useTourWatchers` routes the user to `/tasks`, where the
 * empty-state coachmark guides them to click "New task" themselves. The
 * normal-mode `TaskComposerSheet` then opens with tour-aware prefill (see
 * `TaskListView`).
 */

import {ProviderFlowDialog} from '../../provider/components/provider-flow'
import {useOnboardingStore} from '../stores/onboarding-store'
import {ConnectorStep} from './connector-step'

// Synchronous store snapshot used as a guard inside event handlers — NOT a
// reactive hook. Named with a verb so callers don't mistake it for a derived
// boolean tracked by React.
function snapshotIsProviderStep() {
  return useOnboardingStore.getState().tourStep === 'provider'
}

export function TourHost() {
  const tourActive = useOnboardingStore((s) => s.tourActive)
  const tourStep = useOnboardingStore((s) => s.tourStep)
  const exitTour = useOnboardingStore((s) => s.exitTour)
  const advanceTour = useOnboardingStore((s) => s.advanceTour)

  if (!tourActive || !tourStep) return null

  return (
    <>
      {tourStep === 'provider' && (
        <ProviderFlowDialog
          onOpenChange={(next) => {
            if (next) return
            // The dialog calls onOpenChange(false) on every close — including
            // the success path. Treat it as "user dismissed" only if the
            // success callback hasn't already moved us to the next step.
            if (snapshotIsProviderStep()) exitTour()
          }}
          onProviderActivated={() => advanceTour()}
          open
          tourStepLabel="Step 1 of 4"
        />
      )}

      <ConnectorStep />
    </>
  )
}
