import {useEffect} from 'react'

import {useGetActiveProviderConfig} from '../../provider/api/get-active-provider-config'
import {useOnboardingStore} from '../stores/onboarding-store'

/**
 * Watches store/state transitions that should auto-advance the tour.
 *
 * Currently only the `provider → curate` jump runs here (active provider
 * config becomes available). Curate and query advance on direct user action
 * via the composer's `onSubmitted`. The Tasks-tab coachmark is what guides
 * the user across the tab boundary — we deliberately don't auto-navigate so
 * the click itself becomes the teaching moment.
 */
export function useTourWatchers() {
  const tourActive = useOnboardingStore((s) => s.tourActive)
  const tourStep = useOnboardingStore((s) => s.tourStep)
  const advanceTour = useOnboardingStore((s) => s.advanceTour)

  const {data: activeConfig} = useGetActiveProviderConfig({
    queryConfig: {enabled: tourActive && tourStep === 'provider'},
  })

  useEffect(() => {
    if (!tourActive || tourStep !== 'provider') return
    if (activeConfig?.activeModel) advanceTour()
  }, [tourActive, tourStep, activeConfig?.activeModel, advanceTour])
}
