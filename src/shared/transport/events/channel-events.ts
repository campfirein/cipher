import {z} from 'zod'

import {
  ChannelSchema,
  ContentBlockSchema,
  TurnDeliverySchema,
  TurnEventSchema,
  TurnSchema,
} from '../../types/channel.js'

/**
 * Channel protocol event names.
 *
 * Per `plan/channel-protocol/CHANNEL_PROTOCOL.md` §3, every channel event name
 * is locked from day one so phases do not churn the wire. Phase 1 (this slice)
 * registers handlers for the 7 client-to-host request events listed under the
 * "Phase 1" comment block; Phase 2 wires up mention/cancel/invite/uninvite/
 * members/permission-decision; Phase 3 wires up onboard/doctor. The three
 * broadcast events are emitted by the orchestrator and arrive as broadcasts on
 * the channel's Socket.IO room — they are NOT registered via `onRequest`.
 */
/* eslint-disable perfectionist/sort-objects */
export const ChannelEvents = {
  // Lifecycle (Phase 1 + Phase 2: leave)
  CREATE: 'channel:create',
  LIST: 'channel:list',
  GET: 'channel:get',
  ARCHIVE: 'channel:archive',
  LEAVE: 'channel:leave',

  // Membership (Phase 2: invite/uninvite/members; Phase 3: onboard/doctor)
  INVITE: 'channel:invite',
  UNINVITE: 'channel:uninvite',
  MEMBERS: 'channel:members',
  ONBOARD: 'channel:onboard',
  DOCTOR: 'channel:doctor',

  // Turns (Phase 1: post/list-turns/get-turn; Phase 2: mention/cancel/permission)
  POST: 'channel:post',
  MENTION: 'channel:mention',
  LIST_TURNS: 'channel:list-turns',
  GET_TURN: 'channel:get-turn',
  CANCEL: 'channel:cancel',
  PERMISSION_DECISION: 'channel:permission-decision',

  // Broadcasts (server → client; not registered via onRequest)
  TURN_EVENT: 'channel:turn-event',
  MEMBER_UPDATE: 'channel:member-update',
  STATE_CHANGE: 'channel:state-change',
} as const
/* eslint-enable perfectionist/sort-objects */

export type ChannelEvent = (typeof ChannelEvents)[keyof typeof ChannelEvents]

// ─── Phase-1 request schemas ────────────────────────────────────────────────
// Each Phase-1 client-to-host event has its request and response zod schemas
// here. Phase-2 events are intentionally absent until Phase 2 lands.

// channel:create -------------------------------------------------------------

export const ChannelCreateRequestSchema = z.object({
  channelId: z.string().optional(),
  idempotencyKey: z.string().optional(),
  title: z.string().optional(),
})
export type ChannelCreateRequest = z.infer<typeof ChannelCreateRequestSchema>

export const ChannelCreateResponseSchema = z.object({
  channel: ChannelSchema,
})
export type ChannelCreateResponse = z.infer<typeof ChannelCreateResponseSchema>

// channel:list ---------------------------------------------------------------

export const ChannelListRequestSchema = z.object({
  archived: z.boolean().optional(),
})
export type ChannelListRequest = z.infer<typeof ChannelListRequestSchema>

export const ChannelListResponseSchema = z.object({
  channels: z.array(ChannelSchema),
})
export type ChannelListResponse = z.infer<typeof ChannelListResponseSchema>

// channel:get ----------------------------------------------------------------

export const ChannelGetRequestSchema = z.object({
  channelId: z.string(),
})
export type ChannelGetRequest = z.infer<typeof ChannelGetRequestSchema>

export const ChannelGetResponseSchema = z.object({
  channel: ChannelSchema,
})
export type ChannelGetResponse = z.infer<typeof ChannelGetResponseSchema>

// channel:archive ------------------------------------------------------------

export const ChannelArchiveRequestSchema = z.object({
  channelId: z.string(),
})
export type ChannelArchiveRequest = z.infer<typeof ChannelArchiveRequestSchema>

export const ChannelArchiveResponseSchema = z.object({
  channel: ChannelSchema,
})
export type ChannelArchiveResponse = z.infer<typeof ChannelArchiveResponseSchema>

// channel:post (passive turn — no dispatch) ---------------------------------

export const ChannelPostRequestSchema = z.object({
  channelId: z.string(),
  idempotencyKey: z.string().optional(),
  prompt: z.string().optional(),
  promptBlocks: z.array(ContentBlockSchema).optional(),
})
export type ChannelPostRequest = z.infer<typeof ChannelPostRequestSchema>

export const ChannelPostResponseSchema = z.object({
  deliveries: z.array(TurnDeliverySchema),
  turn: TurnSchema,
})
export type ChannelPostResponse = z.infer<typeof ChannelPostResponseSchema>

// channel:list-turns ---------------------------------------------------------

export const ChannelListTurnsRequestSchema = z.object({
  channelId: z.string(),
  cursor: z.string().optional(),
  limit: z.number().int().positive().optional(),
})
export type ChannelListTurnsRequest = z.infer<typeof ChannelListTurnsRequestSchema>

export const ChannelListTurnsResponseSchema = z.object({
  nextCursor: z.string().optional(),
  turns: z.array(TurnSchema),
})
export type ChannelListTurnsResponse = z.infer<typeof ChannelListTurnsResponseSchema>

// channel:get-turn -----------------------------------------------------------

export const ChannelGetTurnRequestSchema = z.object({
  channelId: z.string(),
  turnId: z.string(),
})
export type ChannelGetTurnRequest = z.infer<typeof ChannelGetTurnRequestSchema>

export const ChannelGetTurnResponseSchema = z.object({
  deliveries: z.array(TurnDeliverySchema).optional(), // passive channels (Phase 1) have no deliveries
  events: z.array(TurnEventSchema),
  turn: TurnSchema,
})
export type ChannelGetTurnResponse = z.infer<typeof ChannelGetTurnResponseSchema>

// ─── Broadcast schemas (server → client on the channel room) ───────────────

export const ChannelTurnEventBroadcastSchema = z.object({
  channelId: z.string(),
  event: TurnEventSchema,
})
export type ChannelTurnEventBroadcast = z.infer<typeof ChannelTurnEventBroadcastSchema>

export const ChannelStateChangeBroadcastSchema = z.object({
  channel: ChannelSchema,
  channelId: z.string(),
})
export type ChannelStateChangeBroadcast = z.infer<typeof ChannelStateChangeBroadcastSchema>
