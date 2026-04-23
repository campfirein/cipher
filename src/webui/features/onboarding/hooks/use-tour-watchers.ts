import {useEffect} from 'react'

import {useGetActiveProviderConfig} from '../../provider/api/get-active-provider-config'
import {useOnboardingStore} from '../stores/onboarding-store'

/**
 * Watches store/state transitions that should auto-advance the tour.
 *
 * Currently: when the user finishes provider setup (active provider config
 * becomes available), advance from the `provider` step to `curate`. The other
 * steps advance on direct user action (composer submit, connector "Done").
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
