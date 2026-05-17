import {useEffect} from 'react'
import {useSearchParams} from 'react-router-dom'

import {useOnboardingStore} from '../stores/onboarding-store'

/**
 * Watches store/state transitions that should auto-advance the tour and run
 * side-effects that the FSM doesn't model directly.
 *
 * - On entering `query`, close any open task detail (`?task=…`) so the
 *   in-flight curate task's detail sheet doesn't hide the "New task" CTA.
 */
export function useTourWatchers() {
  const tourActive = useOnboardingStore((s) => s.tourActive)
  const tourStep = useOnboardingStore((s) => s.tourStep)
  const tourTaskId = useOnboardingStore((s) => s.tourTaskId)
  const [, setSearchParams] = useSearchParams()

  useEffect(() => {
    if (!tourActive || tourStep !== 'query') return
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
