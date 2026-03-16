/**
 * React Query Configuration
 *
 * Shared types and default config for @tanstack/react-query.
 * Mirror of src/tui/lib/react-query.ts.
 */

import type {DefaultOptions, UseMutationOptions} from '@tanstack/react-query'

export const queryConfig = {
  queries: {
    gcTime: 0,
    refetchOnWindowFocus: true,
    retry: false,
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
