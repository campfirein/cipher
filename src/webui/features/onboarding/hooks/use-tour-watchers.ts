import {useEffect} from 'react'
import {useSearchParams} from 'react-router-dom'

import {useGetActiveProviderConfig} from '../../provider/api/get-active-provider-config'
import {useOnboardingStore} from '../stores/onboarding-store'

/**
 * Watches store/state transitions that should auto-advance the tour and run
 * any side-effects that the FSM doesn't model directly.
 *
 * - `provider → curate` auto-advances when the active provider config
 *   becomes available.
 * - On entering `query`, close any open task detail (`?task=…`) — otherwise
 *   the just-finished curate task's detail sheet would still be open and
 *   would hide the FilterBar's "New task" button that the next coachmark
 *   points at.
 *
 * Curate and query advance on direct user action via the composer's
 * `onSubmitted`. The Tasks-tab coachmark is what guides the user across the
 * tab boundary — we deliberately don't auto-navigate so the click itself
 * becomes the teaching moment.
 */
export function useTourWatchers() {
  const tourActive = useOnboardingStore((s) => s.tourActive)
  const tourStep = useOnboardingStore((s) => s.tourStep)
  const tourTaskId = useOnboardingStore((s) => s.tourTaskId)
  const advanceTour = useOnboardingStore((s) => s.advanceTour)
  const [, setSearchParams] = useSearchParams()

  const {data: activeConfig} = useGetActiveProviderConfig({
    queryConfig: {enabled: tourActive && tourStep === 'provider'},
  })

  useEffect(() => {
    if (!tourActive || tourStep !== 'provider') return
    if (activeConfig?.activeModel) advanceTour()
  }, [tourActive, tourStep, activeConfig?.activeModel, advanceTour])

  useEffect(() => {
    if (!tourActive || tourStep !== 'query') return
    // Only strip when no tour task is in flight — `advanceTour` clears
    // `tourTaskId` on transition, so this catches the curate→query moment.
    // After the user submits a query and `tourTaskId` is set again, we
    // bail out so the new query's detail sheet stays open.
    if (tourTaskId) return
    setSearchParams(
      (prev) => {
        if (!prev.has('task')) return prev
        const next = new URLSearchParams(prev)
        next.delete('task')
        return next
      },
      {replace: true},
    )
  }, [tourActive, tourStep, tourTaskId, setSearchParams])
}
