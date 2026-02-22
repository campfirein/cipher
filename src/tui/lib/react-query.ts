/**
 * React Query Configuration
 *
 * Shared types and default config for @tanstack/react-query.
 */

import type {DefaultOptions, UseMutationOptions} from '@tanstack/react-query'

export const queryConfig = {
  queries: {
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: 1000 * 60,
  },
} satisfies DefaultOptions

export type ApiFnReturnType<FnType extends (...args: never[]) => Promise<unknown>> = Awaited<ReturnType<FnType>>

export type QueryConfig<T extends (...args: never[]) => unknown> = Omit<ReturnType<T>, 'queryFn' | 'queryKey'>

export type MutationConfig<MutationFnType extends (...args: never[]) => Promise<unknown>> = UseMutationOptions<
  ApiFnReturnType<MutationFnType>,
  Error,
  Parameters<MutationFnType>[0]
>
