import {z} from 'zod'

import {
  AgentDriverProfileSchema,
  ChannelMemberSchema,
  ChannelSchema,
  ContentBlockSchema,
  HandleSchema,
  RequestPermissionOutcomeSchema,
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

  // Phase 3 ops (rotate-token + profile registry CRUD)
  ROTATE_TOKEN: 'channel:rotate-token',
  PROFILE_LIST: 'channel:profile-list',
  PROFILE_SHOW: 'channel:profile-show',
  PROFILE_REMOVE: 'channel:profile-remove',

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

export const ChannelMemberUpdateBroadcastSchema = z.object({
  channelId: z.string(),
  member: ChannelMemberSchema,
  op: z.enum(['added', 'updated', 'removed']),
})
export type ChannelMemberUpdateBroadcast = z.infer<typeof ChannelMemberUpdateBroadcastSchema>

// ─── Phase-2 request schemas (CHANNEL_PROTOCOL.md §8.2 + §8.4 + §8.5) ──────

// channel:invite -------------------------------------------------------------

const InvocationSchema = z.object({
  args: z.array(z.string()),
  command: z.string(),
  cwd: z.string(),
  env: z.record(z.string()).optional(),
})

/**
 * §8.2 verbatim shape plus two Phase-2 refinements:
 *   (a) `handle` MUST start with `@` (canonical-handle convention).
 *   (b) `profileName` XOR `invocation` — exactly one must be present.
 *
 * Phase 2's handler additionally rejects `profileName` with
 * `CHANNEL_INVALID_REQUEST` because the driver-profile registry doesn't
 * land until Phase 3.
 */
export const ChannelInviteRequestSchema = z
  .object({
    capabilities: z.array(z.string()).optional(),
    channelId: z.string(),
    handle: HandleSchema,
    invocation: InvocationSchema.optional(),
    profileName: z.string().optional(),
  })
  .refine(
    (data) => (data.profileName === undefined) !== (data.invocation === undefined),
    {
      message: 'exactly one of `profileName` or `invocation` must be provided',
      path: ['invocation'],
    },
  )
export type ChannelInviteRequest = z.infer<typeof ChannelInviteRequestSchema>

export const ChannelInviteResponseSchema = z.object({
  member: ChannelMemberSchema,
})
export type ChannelInviteResponse = z.infer<typeof ChannelInviteResponseSchema>

// channel:uninvite -----------------------------------------------------------

export const ChannelUninviteRequestSchema = z.object({
  channelId: z.string(),
  memberHandle: HandleSchema,
})
export type ChannelUninviteRequest = z.infer<typeof ChannelUninviteRequestSchema>

export const ChannelUninviteResponseSchema = z.object({
  member: ChannelMemberSchema,
})
export type ChannelUninviteResponse = z.infer<typeof ChannelUninviteResponseSchema>

// channel:mention ------------------------------------------------------------

export const ChannelMentionRequestSchema = z.object({
  channelId: z.string(),
  idempotencyKey: z.string().optional(),
  lookback: z
    .object({
      facts: z.number().int().nonnegative().optional(),
      recentTurns: z.number().int().nonnegative().optional(),
    })
    .optional(),
  // Both prompt fields are optional at the schema layer — §8.4 emptiness
  // is enforced after normalisation by the prompt normaliser so the wire
  // error surfaces as CHANNEL_PROMPT_EMPTY.
  mentions: z.array(HandleSchema).optional(),
  prompt: z.string().optional(),
  promptBlocks: z.array(ContentBlockSchema).optional(),
})
export type ChannelMentionRequest = z.infer<typeof ChannelMentionRequestSchema>

/**
 * `channel:mention` and `channel:cancel` both return the §8.4
 * `ChannelTurnAcceptedResponse` shape `{turn, deliveries}`.
 */
export const ChannelTurnAcceptedResponseSchema = z.object({
  deliveries: z.array(TurnDeliverySchema),
  turn: TurnSchema,
})
export type ChannelTurnAcceptedResponse = z.infer<typeof ChannelTurnAcceptedResponseSchema>

// channel:cancel -------------------------------------------------------------

export const ChannelCancelRequestSchema = z.object({
  channelId: z.string(),
  deliveryId: z.string().optional(),
  turnId: z.string(),
})
export type ChannelCancelRequest = z.infer<typeof ChannelCancelRequestSchema>

export const ChannelCancelResponseSchema = ChannelTurnAcceptedResponseSchema
export type ChannelCancelResponse = z.infer<typeof ChannelCancelResponseSchema>

// channel:permission-decision ------------------------------------------------

export const ChannelPermissionDecisionRequestSchema = z.object({
  channelId: z.string(),
  outcome: RequestPermissionOutcomeSchema,
  permissionRequestId: z.string(),
  turnId: z.string(),
})
export type ChannelPermissionDecisionRequest = z.infer<typeof ChannelPermissionDecisionRequestSchema>

export const ChannelPermissionDecisionResponseSchema = z.object({
  event: TurnEventSchema,
})
export type ChannelPermissionDecisionResponse = z.infer<typeof ChannelPermissionDecisionResponseSchema>

// ─── Phase-3 request schemas ────────────────────────────────────────────────

// channel:onboard + channel:doctor (CHANNEL_PROTOCOL.md §8.3) ---------------

export const DoctorDiagnosticSchema = z.object({
  code: z.string(),
  details: z.unknown().optional(),
  message: z.string(),
  severity: z.enum(['error', 'info', 'warning']),
})
export type DoctorDiagnostic = z.infer<typeof DoctorDiagnosticSchema>

export const ChannelOnboardRequestSchema = z.object({
  displayName: z.string(),
  invocation: z.object({
    args: z.array(z.string()),
    command: z.string(),
    cwd: z.string(),
    env: z.record(z.string()).optional(),
  }),
  profileName: z.string().min(1),
})
export type ChannelOnboardRequest = z.infer<typeof ChannelOnboardRequestSchema>

export const ChannelOnboardResponseSchema = z.object({
  diagnostics: z.array(DoctorDiagnosticSchema),
  profile: AgentDriverProfileSchema,
})
export type ChannelOnboardResponse = z.infer<typeof ChannelOnboardResponseSchema>

export const ChannelDoctorRequestSchema = z.object({
  channelId: z.string().optional(),
  memberHandle: z.string().optional(),
  profileName: z.string().optional(),
})
export type ChannelDoctorRequest = z.infer<typeof ChannelDoctorRequestSchema>

export const ChannelDoctorResponseSchema = z.object({
  diagnostics: z.array(DoctorDiagnosticSchema),
})
export type ChannelDoctorResponse = z.infer<typeof ChannelDoctorResponseSchema>

// channel:rotate-token -------------------------------------------------------

/**
 * `confirm: true` is a literal — `false` and `undefined` are rejected so a
 * client cannot accidentally rotate the daemon-auth token. The CLI surface
 * (`brv channel rotate-token --yes`) is the user-visible guard; this schema
 * is the wire-side belt-and-suspenders.
 */
export const ChannelRotateTokenRequestSchema = z.object({
  confirm: z.literal(true),
})
export type ChannelRotateTokenRequest = z.infer<typeof ChannelRotateTokenRequestSchema>

export const ChannelRotateTokenResponseSchema = z.object({
  disconnectedClients: z.number().int().nonnegative(),
  tokenFingerprint: z.string(),
})
export type ChannelRotateTokenResponse = z.infer<typeof ChannelRotateTokenResponseSchema>

// channel:profile-list -------------------------------------------------------

export const ChannelProfileListRequestSchema = z.object({})
export type ChannelProfileListRequest = z.infer<typeof ChannelProfileListRequestSchema>

export const ChannelProfileListResponseSchema = z.object({
  profiles: z.array(AgentDriverProfileSchema),
})
export type ChannelProfileListResponse = z.infer<typeof ChannelProfileListResponseSchema>

// channel:profile-show -------------------------------------------------------

export const ChannelProfileShowRequestSchema = z.object({
  name: z.string().min(1),
})
export type ChannelProfileShowRequest = z.infer<typeof ChannelProfileShowRequestSchema>

export const ChannelProfileShowResponseSchema = z.object({
  profile: AgentDriverProfileSchema,
})
export type ChannelProfileShowResponse = z.infer<typeof ChannelProfileShowResponseSchema>

// channel:profile-remove -----------------------------------------------------

export const ChannelProfileRemoveRequestSchema = z.object({
  name: z.string().min(1),
})
export type ChannelProfileRemoveRequest = z.infer<typeof ChannelProfileRemoveRequestSchema>

export const ChannelProfileRemoveResponseSchema = z.object({
  removed: z.boolean(),
})
export type ChannelProfileRemoveResponse = z.infer<typeof ChannelProfileRemoveResponseSchema>

// Re-export the invocation sub-schema so Slice 3.2's onboard service and
// downstream tests can import a single canonical source.


export {AgentDriverProfileInvocationSchema} from '../../types/channel.js'