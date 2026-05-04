export function formatProviderModel(provider?: string, model?: string): string | undefined {
  if (!provider) return undefined
  if (!model) return provider
  return `${provider}:${model}`
}
