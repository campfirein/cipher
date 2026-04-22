/**
 * Post-Login Action Selector
 *
 * Pure decision logic for what the provider flow should do after the OAuth
 * login flow completes. Extracted from ProviderFlow.handleLoginComplete for
 * testability — mirrors the deriveAppViewMode pattern in the onboarding feature.
 */

/**
 * Discriminated union of transitions the provider flow can take after login.
 */
export type PostLoginAction =
  | {message: string; type: 'return-to-select-with-error'}
  | {type: 'connect-byterover'}
  | {type: 'return-to-select'}

/**
 * Parameters for the pure post-login action derivation function.
 */
export type DerivePostLoginActionParams = {
  errorMessage: string
  isAuthorized: boolean
  selectedProviderId?: string
}

/**
 * Decides which transition the provider flow should perform after LoginFlow completes.
 *
 * Decision tree:
 * 1. Not authorized → show the login error and return to provider selection
 * 2. Authorized + ByteRover was selected → resume by connecting/activating ByteRover
 * 3. Otherwise → return to provider selection (defensive — only ByteRover triggers login today)
 */
export function derivePostLoginAction(params: DerivePostLoginActionParams): PostLoginAction {
  if (!params.isAuthorized) {
    return {message: params.errorMessage, type: 'return-to-select-with-error'}
  }

  if (params.selectedProviderId === 'byterover') {
    return {type: 'connect-byterover'}
  }

  return {type: 'return-to-select'}
}
