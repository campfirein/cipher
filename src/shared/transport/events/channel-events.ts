import {z} from 'zod'

import {
  AgentEntry,
  ChannelMeta,
  Turn,
  TurnEvent,
  TurnState,
} from '../../../server/core/domain/channel/types.js'

export const ChannelEvents = {
  ARCHIVE: 'channel:archive',
  /** Notification — surfaces a same-artifact-path conflict for /diff resolution (F6, Q6 sibling). */
  ARTIFACT_CONFLICT: 'channel:artifact-conflict',
  /** Request — fetch base/candidate/parked content for /diff. */
  ARTIFACT_DIFF: 'channel:artifact-diff',
  /** Notification — declared before an agent writes an artifact (F6). */
  ARTIFACT_WRITE_INTENT: 'channel:artifact-write-intent',
  CANCEL: 'channel:cancel',
  CREATE: 'channel:create',
  GET: 'channel:get',
  INVITE: 'channel:invite',
  JOIN: 'channel:join',
  LEAVE: 'channel:leave',
  LIST: 'channel:list',
  MEMBERS: 'channel:members',
  MENTION: 'channel:mention',
  MUTE: 'channel:mute',
  /** Request — resumes a parked turn awaiting permission (F2). */
  PERMISSION_DECISION: 'channel:permission-decision',
  /** Notification — surfaces an ACP `permission/request` (F2). */
  PERMISSION_PROMPT: 'channel:permission-prompt',
  /** Notification — streams TurnEvents to in-process subscribers (Phase 1) and cross-process subscribers (Phase 3). */
  TURN_EVENT: 'channel:turn-event',
} as const

export type ChannelEventName = (typeof ChannelEvents)[keyof typeof ChannelEvents]

// ─── CREATE ────────────────────────────────────────────────────────────────

export const ChannelCreateRequest = z.object({
  channelId: z.string().regex(/^[a-z0-9][\d a-z-]{0,63}$/, 'channelId must be a slug'),
  scope: z.enum(['project', 'global', 'isolated']).default('project'),
  treeRootHint: z.string().optional(),
})
export type ChannelCreateRequestT = z.infer<typeof ChannelCreateRequest>

export const ChannelCreateResponse = z.object({
  meta: ChannelMeta,
})
export type ChannelCreateResponseT = z.infer<typeof ChannelCreateResponse>

// ─── LIST ──────────────────────────────────────────────────────────────────

export const ChannelListRequest = z.object({})
export type ChannelListRequestT = z.infer<typeof ChannelListRequest>

export const ChannelListResponse = z.object({
  channels: z.array(ChannelMeta),
})
export type ChannelListResponseT = z.infer<typeof ChannelListResponse>

// ─── GET ───────────────────────────────────────────────────────────────────

export const ChannelGetRequest = z.object({
  channelId: z.string(),
})
export type ChannelGetRequestT = z.infer<typeof ChannelGetRequest>

export const ChannelGetResponse = z.object({
  meta: ChannelMeta.nullable(),
})
export type ChannelGetResponseT = z.infer<typeof ChannelGetResponse>

// ─── ARCHIVE ───────────────────────────────────────────────────────────────

export const ChannelArchiveRequest = z.object({
  channelId: z.string(),
})
export type ChannelArchiveRequestT = z.infer<typeof ChannelArchiveRequest>

export const ChannelArchiveResponse = z.object({
  meta: ChannelMeta,
})
export type ChannelArchiveResponseT = z.infer<typeof ChannelArchiveResponse>

// ─── INVITE ────────────────────────────────────────────────────────────────

export const ChannelInviteRequest = z.object({
  agents: z.array(AgentEntry).min(1),
  channelId: z.string(),
})
export type ChannelInviteRequestT = z.infer<typeof ChannelInviteRequest>

export const ChannelInviteResponse = z.object({
  meta: ChannelMeta,
})
export type ChannelInviteResponseT = z.infer<typeof ChannelInviteResponse>

// ─── LEAVE ─────────────────────────────────────────────────────────────────

export const ChannelLeaveRequest = z.object({
  agentId: z.string(),
  channelId: z.string(),
})
export type ChannelLeaveRequestT = z.infer<typeof ChannelLeaveRequest>

export const ChannelLeaveResponse = z.object({
  meta: ChannelMeta,
})
export type ChannelLeaveResponseT = z.infer<typeof ChannelLeaveResponse>

// ─── MUTE ──────────────────────────────────────────────────────────────────

export const ChannelMuteRequest = z.object({
  agentId: z.string(),
  channelId: z.string(),
  muted: z.boolean(),
})
export type ChannelMuteRequestT = z.infer<typeof ChannelMuteRequest>

export const ChannelMuteResponse = z.object({
  meta: ChannelMeta,
})
export type ChannelMuteResponseT = z.infer<typeof ChannelMuteResponse>

// ─── MEMBERS ───────────────────────────────────────────────────────────────

export const ChannelMembersRequest = z.object({
  channelId: z.string(),
})
export type ChannelMembersRequestT = z.infer<typeof ChannelMembersRequest>

export const ChannelMembersResponse = z.object({
  members: ChannelMeta.shape.members,
})
export type ChannelMembersResponseT = z.infer<typeof ChannelMembersResponse>

// ─── MENTION ───────────────────────────────────────────────────────────────

export const ChannelMentionRequest = z.object({
  channelId: z.string(),
  prompt: z.string(),
})
export type ChannelMentionRequestT = z.infer<typeof ChannelMentionRequest>

export const ChannelMentionResponse = z.object({
  turns: z.array(Turn),
})
export type ChannelMentionResponseT = z.infer<typeof ChannelMentionResponse>

// ─── CANCEL ────────────────────────────────────────────────────────────────

export const ChannelCancelRequest = z.object({
  channelId: z.string(),
  turnId: z.string(),
})
export type ChannelCancelRequestT = z.infer<typeof ChannelCancelRequest>

export const ChannelCancelResponse = z.object({
  cancelled: z.boolean(),
})
export type ChannelCancelResponseT = z.infer<typeof ChannelCancelResponse>

// ─── JOIN (Phase 1 stub — full TUI in Phase 3) ─────────────────────────────

export const ChannelJoinRequest = z.object({
  channelId: z.string(),
})
export type ChannelJoinRequestT = z.infer<typeof ChannelJoinRequest>

export const ChannelJoinResponse = z.object({
  message: z.string(),
})
export type ChannelJoinResponseT = z.infer<typeof ChannelJoinResponse>

// ─── PERMISSION_DECISION (F2) ──────────────────────────────────────────────

export const ChannelPermissionDecisionRequest = z.object({
  channelId: z.string(),
  decision: z.enum(['allow', 'always', 'deny']),
  permissionRequestId: z.string(),
  turnId: z.string(),
})
export type ChannelPermissionDecisionRequestT = z.infer<typeof ChannelPermissionDecisionRequest>

export const ChannelPermissionDecisionResponse = z.object({
  resumedState: TurnState,
})
export type ChannelPermissionDecisionResponseT = z.infer<typeof ChannelPermissionDecisionResponse>

// ─── ARTIFACT_DIFF (F6) ────────────────────────────────────────────────────

export const ChannelArtifactDiffRequest = z.object({
  baseRevision: z.string().optional(),
  candidateRevision: z.string().optional(),
  channelId: z.string(),
  path: z.string(),
})
export type ChannelArtifactDiffRequestT = z.infer<typeof ChannelArtifactDiffRequest>

export const ChannelArtifactDiffResponse = z.object({
  base: z.string(),
  candidate: z.string(),
  parked: z.string().optional(),
  unifiedDiff: z.string(),
})
export type ChannelArtifactDiffResponseT = z.infer<typeof ChannelArtifactDiffResponse>

// ─── Notifications (server → client broadcasts) ────────────────────────────

export const ChannelTurnEventNotification = z.object({
  channelId: z.string(),
  event: TurnEvent,
  timestamp: z.string().datetime(),
  turnId: z.string(),
})
export type ChannelTurnEventNotificationT = z.infer<typeof ChannelTurnEventNotification>

export const ChannelPermissionPromptNotification = z.object({
  agentId: z.string(),
  channelId: z.string(),
  expiresAt: z.string().datetime(),
  permissionRequestId: z.string(),
  rationale: z.string().optional(),
  toolName: z.string(),
  turnId: z.string(),
})
export type ChannelPermissionPromptNotificationT = z.infer<typeof ChannelPermissionPromptNotification>

export const ChannelArtifactWriteIntentNotification = z.object({
  agentId: z.string(),
  bytesEstimate: z.number().int().nonnegative().optional(),
  channelId: z.string(),
  contentHash: z.string(),
  path: z.string(),
  turnId: z.string(),
})
export type ChannelArtifactWriteIntentNotificationT = z.infer<typeof ChannelArtifactWriteIntentNotification>

export const ChannelArtifactConflictNotification = z.object({
  baseRevision: z.string(),
  channelId: z.string(),
  inFlightContentHash: z.string(),
  inFlightTurnId: z.string(),
  parkedContentHash: z.string(),
  parkedTurnId: z.string(),
  path: z.string(),
})
export type ChannelArtifactConflictNotificationT = z.infer<typeof ChannelArtifactConflictNotification>
