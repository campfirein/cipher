/**
 * Onboarding Types
 */

/** Onboarding flow steps */
export type OnboardingFlowStep = 'curate' | 'curating' | 'explore' | 'init-provider' | 'initing-provider' | 'query' | 'querying'

/** Step transition event types for tracking */
export type StepTransitionEvent = 'curate_completed' | 'query_completed'
