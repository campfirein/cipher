import type {ReactNode} from 'react'

import {QueryClient, QueryClientProvider} from '@tanstack/react-query'

import {TransportProvider} from './transport-provider'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 0,
      refetchOnWindowFocus: true,
      staleTime: 0,
    },
  },
})

export function AppProviders({children}: {children: ReactNode}) {
  return (
    <QueryClientProvider client={queryClient}>
      <TransportProvider>{children}</TransportProvider>
    </QueryClientProvider>
  )
}
