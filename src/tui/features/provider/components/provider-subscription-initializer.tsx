import {useProviderSubscriptions} from '../hooks/use-provider-subscriptions.js'

export function ProviderSubscriptionInitializer(): null {
  useProviderSubscriptions()
  return null
}
