export function formatProviderModel(provider?: string, model?: string, providerName?: string): string | undefined {
  if (!provider) return undefined
  const display = providerName || provider
  if (!model) return display
  return `${display}:${model}`
}
