/**
 * Tour host
 *
 * Mounted once at the layout level. Reads the tour step from the onboarding
 * store and renders the right "tour-driven" surface for that step:
 *
 *   provider  → ProviderFlowDialog (auto-advances via use-tour-watchers when
 *               an active provider becomes configured)
 *   curate    → TaskComposerSheet prefilled with a curate example (advances
 *               on successful submit via the sheet's onSubmitted callback)
 *   query     → same, prefilled with a query example
 *   connector → ConnectorStep (advances on the user's "Done" click)
 *
 * Tour-aware UI (the step pill on the provider dialog, etc.) lives inside the
 * relevant components themselves and toggles on `useOnboardingStore.tourStep`.
 */

import {useRef} from 'react'
import {useNavigate} from 'react-router-dom'

import {ProviderFlowDialog} from '../../provider/components/provider-flow'
import {TaskComposerSheet} from '../../tasks/components/task-composer'
import {useOnboardingStore} from '../stores/onboarding-store'
import {ConnectorStep} from './connector-step'

// Synchronous store snapshot used as a guard inside event handlers — NOT a
// reactive hook. Named with a verb so callers don't mistake it for a derived
// boolean tracked by React.
function snapshotIsProviderStep() {
  return useOnboardingStore.getState().tourStep === 'provider'
}

const CURATE_EXAMPLE =
  'List the most important conventions and patterns used in this codebase — naming, file organization, testing approach, and any rules a new contributor should know before making changes.'
const QUERY_EXAMPLE = 'What conventions should I follow when making changes?'

export function TourHost() {
  const tourActive = useOnboardingStore((s) => s.tourActive)
  const tourStep = useOnboardingStore((s) => s.tourStep)
  const tourTaskId = useOnboardingStore((s) => s.tourTaskId)
  const exitTour = useOnboardingStore((s) => s.exitTour)
  const advanceTour = useOnboardingStore((s) => s.advanceTour)
  const setTourTaskId = useOnboardingStore((s) => s.setTourTaskId)
  const navigate = useNavigate()

  // The composer fires onSubmitted *and then* onClose synchronously after a
  // successful submit. Without this guard, onClose would call exitTour() right
  // after onSubmitted set the tour task — and exitTour would win the batched
  // setState. The flag is set in onSubmitted and consumed in onClose so only
  // user-initiated closes exit the tour.
  const submittedRef = useRef(false)

  if (!tourActive || !tourStep) return null

  // While a tour task is in flight (curate/query submitted, awaiting completion)
  // keep the composer closed so the user can watch the task run in the detail
  // view. The Continue CTA in the detail view advances the tour.
  const showComposer = (tourStep === 'curate' || tourStep === 'query') && !tourTaskId

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

      {showComposer && (
        <TaskComposerSheet
          initialContent={tourStep === 'curate' ? CURATE_EXAMPLE : QUERY_EXAMPLE}
          initialType={tourStep}
          // key forces a remount when the tour transitions curate → query so
          // the composer's internal state (content, type) re-seeds from the
          // new initial props instead of retaining the previous step's draft.
          key={tourStep}
          onClose={() => {
            if (submittedRef.current) {
              submittedRef.current = false
              return
            }

            exitTour()
          }}
          onSubmitted={(taskId) => {
            submittedRef.current = true
            // Tour stays on the current step; record the in-flight task and
            // navigate to its detail. The user advances via the Continue CTA
            // once the task completes.
            setTourTaskId(taskId)
            navigate(`/tasks?task=${taskId}`)
          }}
          open
          prefillNotice="example"
          tourStepLabel={tourStep === 'curate' ? 'Step 2 of 4' : 'Step 3 of 4'}
        />
      )}

      <ConnectorStep />
    </>
  )
}
