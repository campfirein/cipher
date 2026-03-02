/**
 * Onboarding Utils
 *
 * Pure functions for computing step transitions based on task states.
 * This makes the state machine explicit and testable.
 */

import type {Task} from '../tasks/stores/tasks-store.js'
import type {OnboardingFlowStep, StepTransitionEvent} from './types.js'

interface StepTransitionContext {
  currentStep: OnboardingFlowStep
  tasks: Map<string, Task>
}

/**
 * Analyze tasks to determine curate/query execution states.
 */
function analyzeTaskStates(tasks: Map<string, Task>) {
  let isCurating = false
  let hasCurated = false
  let isQuerying = false
  let hasQueried = false

  for (const task of tasks.values()) {
    if (task.type === 'curate') {
      if (task.status === 'completed') hasCurated = true
      if (task.status === 'started' || task.status === 'created') isCurating = true
    }

    if (task.type === 'query') {
      if (task.status === 'completed') hasQueried = true
      if (task.status === 'started' || task.status === 'created') isQuerying = true
    }
  }

  return {hasCurated, hasQueried, isCurating, isQuerying}
}

/**
 * Compute the next step based on current step and task states.
 *
 * State machine transitions:
 * - curate -> curating (when curate task starts)
 * - curating -> query (when curate task completes)
 * - query -> querying (when query task starts)
 * - querying -> explore (when query task completes)
 * - explore (terminal state)
 */
export function computeNextStep(ctx: StepTransitionContext): OnboardingFlowStep {
  const {currentStep, tasks} = ctx
  const {hasCurated, hasQueried, isCurating, isQuerying} = analyzeTaskStates(tasks)

  switch (currentStep) {
    case 'curate': {
      return isCurating ? 'curating' : 'curate'
    }

    case 'curating': {
      return hasCurated ? 'query' : 'curating'
    }

    case 'explore': {
      return 'explore'
    }

    case 'query': {
      return isQuerying ? 'querying' : 'query'
    }

    case 'querying': {
      return hasQueried ? 'explore' : 'querying'
    }

    default: {
      return currentStep
    }
  }
}

/**
 * Determine if a step transition should trigger a tracking event.
 */
export function getTransitionEvent(
  previousStep: OnboardingFlowStep,
  newStep: OnboardingFlowStep,
): null | StepTransitionEvent {
  if (previousStep === 'curating' && newStep === 'query') {
    return 'curate_completed'
  }

  if (previousStep === 'querying' && newStep === 'explore') {
    return 'query_completed'
  }

  return null
}
