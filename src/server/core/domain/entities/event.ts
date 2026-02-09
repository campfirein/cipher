/**
 * Array of all supported Events.
 */
export const EVENT_VALUES = [
  'repl',
  'auth:sign_in',
  'auth:signed_out',
  'auth:token_invalid',
  'space:init',
  'space:changed',
  'rule:generate',
  'connectors:configure',
  'connector:install',
  'connector:list',
  'connector:switch',
  'connector:switched',
  'mem:status',
  'mem:curate',
  'mem:pull',
  'mem:push',
  'mem:query',
  'onboarding:init_completed',
  'onboarding:curate_completed',
  'onboarding:query_completed',
  'onboarding:skipped',
  'onboarding:completed',
  'init',
] as const

export type EventName = (typeof EVENT_VALUES)[number]

export interface PropertyDict {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}
