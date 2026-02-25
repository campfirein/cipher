/**
 * React Query Configuration
 *
 * Shared types and default config for @tanstack/react-query.
 */

import type {DefaultOptions, UseMutationOptions} from '@tanstack/react-query'

export const queryConfig = {
  queries: {
    // cached data is garbage collected immediately after unmount,
    // so no stale data is ever served
    gcTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
    // data is stale immediately,
    // so React Query will refetch on triggers
    staleTime: 0,
  },
} satisfies DefaultOptions

export type ApiFnReturnType<FnType extends (...args: never[]) => Promise<unknown>> = Awaited<ReturnType<FnType>>

export type QueryConfig<T extends (...args: never[]) => unknown> = Omit<ReturnType<T>, 'queryFn' | 'queryKey'>

export type MutationConfig<MutationFnType extends (...args: never[]) => Promise<unknown>> = UseMutationOptions<
  ApiFnReturnType<MutationFnType>,
  Error,
  Parameters<MutationFnType>[0]
>
