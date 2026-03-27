import type {ReactNode} from 'react'

import {QueryClient, QueryClientProvider} from '@tanstack/react-query'

import {AuthInitializer} from '../features/auth/components/auth-initializer'
import {ProviderSubscriptionInitializer} from '../features/provider/components/provider-subscription-initializer'
import {queryConfig} from '../lib/react-query'
import {TransportProvider} from './transport-provider'

const queryClient = new QueryClient({
  defaultOptions: queryConfig,
})

export function AppProviders({children}: {children: ReactNode}) {
  return (
    <QueryClientProvider client={queryClient}>
      <TransportProvider>
        <AuthInitializer>
          <ProviderSubscriptionInitializer />
          {children}
        </AuthInitializer>
      </TransportProvider>
    </QueryClientProvider>
  )
}
