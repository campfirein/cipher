/* eslint-disable perfectionist/sort-interfaces */
/**
 * Store for onboarding preferences.
 * Used to persist when onboarding was last dismissed to implement
 * cooldown periods (e.g., show onboarding at most once per week).
 */
export interface IOnboardingPreferenceStore {
  /**
   * Get the timestamp when onboarding was last dismissed.
   * Returns undefined if never dismissed.
   */
  getLastDismissedAt(): Promise<number | undefined>

  /**
   * Set the timestamp when onboarding was dismissed.
   */
  setLastDismissedAt(timestamp: number): Promise<void>

  /**
   * Clear the stored preference.
   */
  clear(): Promise<void>
}
