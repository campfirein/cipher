export const OnboardingEvents = {
  AUTO_SETUP: 'onboarding:autoSetup',
  COMPLETE: 'onboarding:complete',
  GET_STATE: 'onboarding:getState',
} as const

export interface OnboardingGetStateResponse {
  hasOnboarded: boolean
}

export interface OnboardingAutoSetupResponse {
  error?: string
  success: boolean
}

export interface OnboardingCompleteRequest {
  skipped?: boolean
}

export interface OnboardingCompleteResponse {
  success: boolean
}
