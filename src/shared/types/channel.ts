/* eslint-disable perfectionist/sort-objects */
import {z} from 'zod'

/**
 * Channel-protocol shared wire types and zod schemas.
 *
 * This module is the canonical home for the on-the-wire and on-disk shapes
 * defined in `plan/channel-protocol/CHANNEL_PROTOCOL.md` §4 and §10. Both the
 * shared transport layer (`src/shared/transport/events/channel-events.ts`)
 * and the server-side domain layer (`src/server/core/domain/channel/`, added
 * in Slice 1.3) import from here so the channel format is defined exactly
 * once.
 *
 * ACP type alignment: `ContentBlock`-typed fields (e.g. `Turn.promptBlocks`)
 * are validated at runtime via {@link ContentBlockSchema} below, which mirrors
 * the discriminator + required fields of the `ContentBlock` union exported by
 * `@agentclientprotocol/sdk`. The local zod schema uses `passthrough()` so
 * additional ACP fields (annotations, mime types, etc.) round-trip unchanged
 * even if we don't model them yet. Type bridging to the ACP TS types is
 * deliberately lightweight in Phase 1 — orchestrator code that needs strict
 * ACP alignment imports from `@agentclientprotocol/sdk` directly.
 */

// ─── ACP ContentBlock ───────────────────────────────────────────────────────

const TextContentBlockSchema = z
  .object({
    type: z.literal('text'),
    text: z.string(),
  })
  .passthrough()

const ImageContentBlockSchema = z
  .object({
    type: z.literal('image'),
    data: z.string(),
    mimeType: z.string(),
  })
  .passthrough()

const AudioContentBlockSchema = z
  .object({
    type: z.literal('audio'),
    data: z.string(),
    mimeType: z.string(),
  })
  .passthrough()

const ResourceLinkContentBlockSchema = z
  .object({
    type: z.literal('resource_link'),
    uri: z.string(),
  })
  .passthrough()

const EmbeddedResourceContentBlockSchema = z
  .object({
    type: z.literal('resource'),
    resource: z.object({}).passthrough(),
  })
  .passthrough()

/**
 * ACP `ContentBlock` discriminated union (`type` field). Aligned with the
 * shape exported by `@agentclientprotocol/sdk`. `passthrough()` preserves
 * ACP-specified fields we don't yet model.
 */
export const ContentBlockSchema = z.discriminatedUnion('type', [
  TextContentBlockSchema,
  ImageContentBlockSchema,
  AudioContentBlockSchema,
  ResourceLinkContentBlockSchema,
  EmbeddedResourceContentBlockSchema,
])

export type ContentBlock = z.infer<typeof ContentBlockSchema>

// ─── TurnAuthor ─────────────────────────────────────────────────────────────

export const TurnAuthorSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('acp-agent'),
    handle: z.string(),
  }),
  z.object({
    kind: z.literal('local-agent'),
    handle: z.literal('@brv'),
  }),
  z.object({
    kind: z.literal('local-user'),
    handle: z.literal('you'),
    sessionId: z.string().optional(),
  }),
  z.object({
    kind: z.literal('human-messaging'),
    transport: z.literal('whatsapp'),
    handle: z.string(),
    accountId: z.string(),
    peerId: z.string(),
    displayName: z.string().optional(),
  }),
])
export type TurnAuthor = z.infer<typeof TurnAuthorSchema>

// ─── ChannelMember ──────────────────────────────────────────────────────────

/**
 * Canonical Phase-2 handle: must start with `@`. Phase 1 shipped passive
 * channels with no members, so no migration is required; this refinement
 * is enforced at the schema layer from Phase 2 onward.
 */
export const HandleSchema = z.string().regex(/^@/, 'channel member handle must start with "@"')

const ChannelMemberBaseShape = {
  joinedAt: z.string().datetime(),
  lastTurnAt: z.string().datetime().optional(),
} as const

const AcpAgentStatusSchema = z.enum([
  'idle',
  'thinking',
  'awaiting_permission',
  'errored',
  'muted',
  'left',
  'acp_incompatible',
])

const LocalAgentStatusSchema = z.enum([
  'idle',
  'thinking',
  'awaiting_permission',
  'errored',
  'muted',
  'left',
])

const HumanMessagingStatusSchema = z.enum(['active', 'paired', 'muted', 'left'])

export const ChannelMemberAcpAgentSchema = z.object({
  ...ChannelMemberBaseShape,
  memberKind: z.literal('acp-agent'),
  handle: HandleSchema,
  agentName: z.string(),
  invocation: z.object({
    command: z.string(),
    args: z.array(z.string()),
    cwd: z.string(),
    env: z.record(z.string()).optional(),
  }),
  driverClass: z.enum(['A', 'B', 'C-prime']),
  acpVersion: z.string().optional(),
  capabilities: z.array(z.string()),
  status: AcpAgentStatusSchema,
})
export type ChannelMemberAcpAgent = z.infer<typeof ChannelMemberAcpAgentSchema>

const ChannelMemberLocalAgentSchema = z.object({
  ...ChannelMemberBaseShape,
  memberKind: z.literal('local-agent'),
  handle: HandleSchema,
  agentName: z.string(),
  status: LocalAgentStatusSchema,
})

const ChannelMemberHumanMessagingSchema = z.object({
  ...ChannelMemberBaseShape,
  memberKind: z.literal('human-messaging'),
  transport: z.literal('whatsapp'),
  accountId: z.string(),
  peerId: z.string(),
  handle: HandleSchema,
  displayName: z.string().optional(),
  status: HumanMessagingStatusSchema,
})

export const ChannelMemberSchema = z.discriminatedUnion('memberKind', [
  ChannelMemberAcpAgentSchema,
  ChannelMemberLocalAgentSchema,
  ChannelMemberHumanMessagingSchema,
])
export type ChannelMember = z.infer<typeof ChannelMemberSchema>

/**
 * Lightweight summary shape used in `Channel.members[]` for `channel:list` and
 * `channel:get` responses (per CHANNEL_PROTOCOL.md §5.1 + §10). Callers that
 * need full member records (with invocation specs, joinedAt, etc.) use
 * `channel:members`.
 */
export const ChannelMemberSummarySchema = z.object({
  memberKind: z.enum(['acp-agent', 'local-agent', 'human-messaging']),
  handle: z.string(),
  displayName: z.string().optional(),
  status: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
})
export type ChannelMemberSummary = z.infer<typeof ChannelMemberSummarySchema>

// ─── Turn + TurnDelivery ────────────────────────────────────────────────────

export const TurnStateSchema = z.enum(['pending', 'dispatched', 'completed', 'cancelled'])
export type TurnState = z.infer<typeof TurnStateSchema>

export const TurnSchema = z.object({
  channelId: z.string(),
  turnId: z.string(),
  author: TurnAuthorSchema,
  promptBlocks: z.array(ContentBlockSchema),
  mentions: z.array(z.string()),
  promptedBy: z.enum(['user', 'agent', 'human-messaging']),
  state: TurnStateSchema,
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().optional(),
  idempotencyKey: z.string().optional(),
})
export type Turn = z.infer<typeof TurnSchema>

export const TurnDeliveryStateSchema = z.enum([
  'queued',
  'dispatched',
  'streaming',
  'awaiting_permission',
  'completed',
  'cancelled',
  'errored',
])
export type TurnDeliveryState = z.infer<typeof TurnDeliveryStateSchema>

export const TurnDeliverySchema = z.object({
  channelId: z.string(),
  turnId: z.string(),
  deliveryId: z.string(),
  memberHandle: z.string(),
  state: TurnDeliveryStateSchema,
  acpSessionId: z.string().optional(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().optional(),
  toolCallCount: z.number().int().nonnegative(),
  tokensUsed: z.number().int().nonnegative().optional(),
  artifactsTouched: z.array(z.string()),
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
})
export type TurnDelivery = z.infer<typeof TurnDeliverySchema>

// ─── TurnEvent (full union per CHANNEL_PROTOCOL.md §7.1) ────────────────────

// Base shape every TurnEvent variant extends.
const TurnEventBaseShape = {
  channelId: z.string(),
  turnId: z.string(),
  deliveryId: z.string().nullable(),
  memberHandle: z.string().nullable(),
  emittedAt: z.string().datetime(),
  seq: z.number().int().nonnegative(),
} as const

export const PermissionOptionSchema = z
  .object({
    optionId: z.string(),
    name: z.string(),
    kind: z.enum(['allow_once', 'allow_always', 'reject_once', 'reject_always']),
  })
  .passthrough()
export type PermissionOption = z.infer<typeof PermissionOptionSchema>

export const RequestPermissionOutcomeSchema = z.discriminatedUnion('outcome', [
  z.object({outcome: z.literal('cancelled')}),
  z.object({outcome: z.literal('selected'), optionId: z.string()}),
])
export type RequestPermissionOutcome = z.infer<typeof RequestPermissionOutcomeSchema>

export const TurnEventSchema = z.discriminatedUnion('kind', [
  z.object({
    ...TurnEventBaseShape,
    kind: z.literal('message'),
    role: z.enum(['acp-agent', 'local-agent', 'user', 'human-messaging']),
    content: z.string(),
    summary: z.string().optional(),
  }),
  z.object({
    ...TurnEventBaseShape,
    kind: z.literal('agent_message_chunk'),
    content: z.string(),
  }),
  z.object({
    ...TurnEventBaseShape,
    kind: z.literal('agent_thought_chunk'),
    content: z.string(),
  }),
  z.object({
    ...TurnEventBaseShape,
    kind: z.literal('tool_call'),
    toolCallId: z.string(),
    name: z.string(),
    input: z.unknown(),
  }),
  z.object({
    ...TurnEventBaseShape,
    kind: z.literal('tool_call_update'),
    toolCallId: z.string(),
    status: z.enum(['in_progress', 'completed', 'failed']).optional(),
    output: z.unknown().optional(),
    error: z.string().optional(),
  }),
  z.object({
    ...TurnEventBaseShape,
    kind: z.literal('permission_request'),
    permissionRequestId: z.string(),
    request: z
      .object({
        sessionId: z.string(),
        toolCall: z.unknown(),
        options: z.array(PermissionOptionSchema),
      })
      .passthrough(),
  }),
  z.object({
    ...TurnEventBaseShape,
    kind: z.literal('permission_decision'),
    permissionRequestId: z.string(),
    outcome: RequestPermissionOutcomeSchema,
  }),
  z.object({
    ...TurnEventBaseShape,
    kind: z.literal('plan'),
    entries: z.array(z.unknown()),
  }),
  z.object({
    ...TurnEventBaseShape,
    kind: z.literal('artifact'),
    path: z.string(),
    op: z.enum(['created', 'modified', 'deleted']),
  }),
  z.object({
    ...TurnEventBaseShape,
    kind: z.literal('delivery_state_change'),
    from: TurnDeliveryStateSchema,
    to: TurnDeliveryStateSchema,
    error: z.string().optional(),
  }),
  z.object({
    ...TurnEventBaseShape,
    kind: z.literal('turn_state_change'),
    from: TurnStateSchema,
    to: TurnStateSchema,
  }),
])
export type TurnEvent = z.infer<typeof TurnEventSchema>

// ─── Channel + ChannelMeta ──────────────────────────────────────────────────

export const ChannelSettingsSchema = z.object({
  maxParallelAgents: z.number().int().positive().optional(),
  defaultLookbackTurns: z.number().int().nonnegative().optional(),
})
export type ChannelSettings = z.infer<typeof ChannelSettingsSchema>

export const ChannelSchema = z.object({
  channelId: z.string(),
  title: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  archivedAt: z.string().datetime().optional(),
  members: z.array(ChannelMemberSummarySchema),
  memberCount: z.number().int().nonnegative(),
  settings: ChannelSettingsSchema.optional(),
})
export type Channel = z.infer<typeof ChannelSchema>

/**
 * On-disk `meta.json` shape. Per CHANNEL_PROTOCOL.md §4.2 `meta.json` is the
 * mutable source of truth for membership + settings; per-turn state lives in
 * `turns/<turn-id>/`. The wire `Channel` (above) is a projection of this plus
 * derived fields (`memberCount`, summarised `members[]`).
 */
export const ChannelMetaSchema = z.object({
  channelId: z.string(),
  title: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  archivedAt: z.string().datetime().optional(),
  members: z.array(ChannelMemberSchema),
  settings: ChannelSettingsSchema.optional(),
})
export type ChannelMeta = z.infer<typeof ChannelMetaSchema>
