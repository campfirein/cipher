import type {ReactNode} from 'react'

import {TooltipProvider} from '@campfirein/byterover-packages/components/tooltip'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'

import {queryConfig} from '../lib/react-query'
import {TransportProvider} from './transport-provider'

const queryClient = new QueryClient({
  defaultOptions: queryConfig,
})

export function AppProviders({children}: {children: ReactNode}) {
  return (
    <QueryClientProvider client={queryClient}>
      <TransportProvider>
        <TooltipProvider delay={0}>{children}</TooltipProvider>
      </TransportProvider>
    </QueryClientProvider>
  )
}
