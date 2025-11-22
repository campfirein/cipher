/**
 * Array of all supported Events.
 */
export const EVENT_VALUES = [
  'auth:signed_in',
  'auth:signed_out',
  'space:init',
  'space:changed',
  'rule:generate',
  'ace:add_bullet',
  'ace:update_bullet',
  'ace:remove_bullet',
  'ace:view_status',
  'ace:query',
  'mem:push',
  'mem:retrieve',
] as const

export type EventName = (typeof EVENT_VALUES)[number]

export interface PropertyDict {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}
