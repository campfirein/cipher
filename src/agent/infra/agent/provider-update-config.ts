/**
 * Configuration payload for hot-swapping the LLM provider/model at runtime.
 * Passed from the daemon state server to CipherAgent.refreshProviderConfig().
 *
 * Fields mirror the provider-specific subset of ProviderConfigResponse (schemas.ts).
 * When adding a new provider field to ProviderConfigResponse, update this type
 * and the explicit mapping in agent-process.ts hotSwapProvider() accordingly.
 */
export interface ProviderUpdateConfig {
  maxInputTokens?: number
  model: string
  openRouterApiKey?: string
  provider?: string
  providerApiKey?: string
  providerBaseUrl?: string
  providerHeaders?: Record<string, string>
}
