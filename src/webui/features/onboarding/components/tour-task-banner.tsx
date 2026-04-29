import {Button} from '@campfirein/byterover-packages/components/button'
import {ArrowRight, Check} from 'lucide-react'

import type {StoredTask} from '../../tasks/types/stored-task'

import {useOnboardingStore} from '../stores/onboarding-store'
import {TourStepBadge} from './tour-step-badge'

const STEP_LABEL: Record<'curate' | 'query', string> = {
  curate: 'Step 2 of 4',
  query: 'Step 3 of 4',
}

const NEXT_LABEL: Record<'curate' | 'query', string> = {
  curate: 'Continue to query',
  query: 'Continue to connector',
}

const RUNNING_HINT: Record<'curate' | 'query', string> = {
  curate: 'Watch the agent capture this knowledge into your context tree.',
  query: 'Watch the agent search the context tree and synthesize an answer.',
}

const DONE_HINT: Record<'curate' | 'query', string> = {
  curate: 'Knowledge captured. Ready to ask a question about it?',
  query: 'Answer synthesized. One last step — connect ByteRover to your AI tool.',
}

function useActiveTourTask(task: StoredTask) {
  const tourActive = useOnboardingStore((s) => s.tourActive)
  const tourStep = useOnboardingStore((s) => s.tourStep)
  const tourTaskId = useOnboardingStore((s) => s.tourTaskId)

  const isMatch =
    tourActive && tourTaskId === task.taskId && (tourStep === 'curate' || tourStep === 'query')

  return isMatch ? (tourStep as 'curate' | 'query') : null
}

function bannerHint(status: StoredTask['status'], step: 'curate' | 'query'): string {
  if (status === 'completed') return 'Task done. Scroll for the Continue button.'
  if (status === 'error') return 'Task failed. Use Try again below or fix the provider config.'
  if (status === 'cancelled') return 'Task cancelled. Use Try again below to retry.'
  return RUNNING_HINT[step]
}

/**
 * Top-of-detail banner. Pins the tour step pill + a brief running hint above
 * the task content so the user knows they're still in the tour.
 */
export function TourTaskBanner({task}: {task: StoredTask}) {
  const step = useActiveTourTask(task)
  if (!step) return null

  return (
    <div className="border-primary-foreground/30 bg-primary/8 flex items-center gap-3 rounded-lg border px-4 py-2.5">
      <TourStepBadge label={STEP_LABEL[step]} />
      <span className="text-muted-foreground text-sm">{bannerHint(task.status, step)}</span>
    </div>
  )
}

/**
 * Bottom-of-detail CTA. Only renders on a successful completion — failed and
 * cancelled tasks need to be retried before the tour can advance, so we let
 * the ErrorSection's "Try again" CTA carry the action and stay silent here.
 */
export function TourTaskContinueCta({task}: {task: StoredTask}) {
  const advanceTour = useOnboardingStore((s) => s.advanceTour)
  const step = useActiveTourTask(task)
  if (!step || task.status !== 'completed') return null

  return (
    <div className="border-primary-foreground/40 bg-primary/12 flex items-center gap-4 rounded-lg border px-4 py-3.5">
      <span className="bg-primary-foreground/20 text-primary-foreground grid size-8 shrink-0 place-items-center rounded-full">
        <Check className="size-4" strokeWidth={3} />
      </span>
      <div className="flex-1">
        <p className="text-foreground text-sm font-medium">{DONE_HINT[step]}</p>
        <p className="text-muted-foreground text-xs">{STEP_LABEL[step]} complete</p>
      </div>
      <Button onClick={() => advanceTour()} type="button">
        {NEXT_LABEL[step]}
        <ArrowRight className="size-4" />
      </Button>
    </div>
  )
}
