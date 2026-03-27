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
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: 0,
  },
} satisfies DefaultOptions

export type ApiFnReturnType<FnType extends (...args: never[]) => Promise<unknown>> = Awaited<ReturnType<FnType>>

export type QueryConfig<T extends (...args: never[]) => unknown> = Omit<ReturnType<T>, 'queryFn' | 'queryKey'>

type MutationVariables<MutationFnType extends (...args: never[]) => Promise<unknown>> = Parameters<MutationFnType> extends []
  ? void
  : Parameters<MutationFnType>[0]

export type MutationConfig<MutationFnType extends (...args: never[]) => Promise<unknown>> = UseMutationOptions<
  ApiFnReturnType<MutationFnType>,
  Error,
  MutationVariables<MutationFnType>
>
