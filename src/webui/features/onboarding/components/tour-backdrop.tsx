import {useOnboardingStore} from '../stores/onboarding-store'

/**
 * Page-wide dim + blur during the curate/query tour steps. Sits beneath the
 * tour bar (z-100) and beneath any TourPointer-wrapped target (z-50), so the
 * highlighted controls stay sharp while the rest of the UI fades back.
 *
 * Active on every route (not just `/tasks`) because the Tasks-tab coachmark
 * lives in the global header — when the user is on a different page, the
 * backdrop draws focus to that coachmark too.
 *
 * Click-blocking is intentional: the rest of the page is clearly out of
 * focus, and we don't want a stray click on a blurred Configuration tab to
 * yank the user away from the tour. They exit via the TourBar.
 */
export function TourBackdrop() {
  const tourActive = useOnboardingStore((s) => s.tourActive)
  const tourStep = useOnboardingStore((s) => s.tourStep)
  const tourTaskId = useOnboardingStore((s) => s.tourTaskId)

  const inComposerStep = tourStep === 'curate' || tourStep === 'query'
  const show = tourActive && inComposerStep && !tourTaskId
  if (!show) return null

  return <div aria-hidden className="bg-background/50 fixed inset-0 z-40 backdrop-blur-xs" />
}
