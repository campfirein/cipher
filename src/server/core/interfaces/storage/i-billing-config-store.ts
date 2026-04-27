/**
 * Persists billing-related user preferences (currently: the pinned organization
 * the user wants to bill by default for ByteRover-routed LLM calls).
 *
 * Stored at the user-global level (not per-project) since the same identity is
 * billed regardless of which workspace the call originates from.
 */
export interface IBillingConfigStore {
  getPinnedOrganizationId: () => Promise<string | undefined>
  setPinnedOrganizationId: (organizationId: string | undefined) => Promise<void>
}
