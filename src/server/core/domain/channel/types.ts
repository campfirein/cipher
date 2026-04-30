import {z} from 'zod'

export const ChannelStatus = z.enum(['active', 'archived', 'disposed'])
export type ChannelStatus = z.infer<typeof ChannelStatus>

export const TurnState = z.enum([
  'submitted',
  'routing',
  'in_flight',
  'awaiting_permission',
  'expired',
  'completed',
  'failed',
  'cancelled',
])
export type TurnState = z.infer<typeof TurnState>

export const TurnTransitionEvent = z.discriminatedUnion('type', [
  z.object({type: z.literal('route')}),
  z.object({type: z.literal('start')}),
  z.object({
    permissionRequestId: z.string(),
    type: z.literal('await_permission'),
  }),
  z.object({
    decision: z.enum(['allow', 'deny', 'always']),
    type: z.literal('permission_decision'),
  }),
  z.object({type: z.literal('expire')}),
  z.object({type: z.literal('complete')}),
  z.object({
    reason: z.string(),
    type: z.literal('fail'),
  }),
  z.object({type: z.literal('cancel')}),
])
export type TurnTransitionEvent = z.infer<typeof TurnTransitionEvent>

export const AgentRole = z.enum(['coding-agent', 'personal-assistant', 'observer'])
export type AgentRole = z.infer<typeof AgentRole>

export const AcpLaunchSpec = z.discriminatedUnion('kind', [
  z.object({
    args: z.array(z.string()),
    command: z.string(),
    env: z.record(z.string(), z.string()).optional(),
    kind: z.literal('stdio'),
  }),
  z.object({
    host: z.string(),
    kind: z.literal('tcp'),
    port: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal('mock'),
    mockId: z.string(),
  }),
])
export type AcpLaunchSpec = z.infer<typeof AcpLaunchSpec>

export const AgentEntry = z.object({
  displayName: z.string(),
  id: z.string(),
  launch: AcpLaunchSpec,
  role: AgentRole,
})
export type AgentEntry = z.infer<typeof AgentEntry>

export const ChannelMember = z.object({
  acpVersion: z.string().optional(),
  agentId: z.string(),
  cliVersion: z.string().optional(),
  joinedAt: z.string().datetime(),
  lastTurnAt: z.string().datetime().optional(),
  status: z.enum([
    'idle',
    'thinking',
    'awaiting_permission',
    'errored',
    'muted',
    'left',
    'acp_incompatible',
  ]),
})
export type ChannelMember = z.infer<typeof ChannelMember>

export const ChannelMeta = z.object({
  channelId: z.string(),
  createdAt: z.string().datetime(),
  includes: z.string().optional(),
  members: z.array(ChannelMember),
  scope: z.enum(['project', 'global', 'isolated']),
  status: ChannelStatus,
  treeRoot: z.string(),
  turnCount: z.number().int().nonnegative(),
})
export type ChannelMeta = z.infer<typeof ChannelMeta>

export const TurnEvent = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('status'),
    status: z.enum(['starting', 'thinking', 'tool', 'writing', 'awaiting_permission', 'done', 'error']),
  }),
  z.object({
    kind: z.literal('tool'),
    latencyMs: z.number(),
    name: z.string(),
    ok: z.boolean(),
  }),
  z.object({
    delta: z.string(),
    kind: z.literal('token'),
  }),
  z.object({
    bytesEstimate: z.number().int().nonnegative().optional(),
    contentHash: z.string(),
    kind: z.literal('artifact_intent'),
    path: z.string(),
  }),
  z.object({
    bytes: z.number().int().nonnegative(),
    kind: z.literal('artifact'),
    path: z.string(),
    summary: z.string().optional(),
  }),
  z.object({
    content: z.string(),
    kind: z.literal('message'),
    role: z.literal('agent'),
    summary: z.string().optional(),
  }),
  z.object({
    kind: z.literal('permission_request'),
    permissionRequestId: z.string(),
    rationale: z.string().optional(),
    toolName: z.string(),
  }),
  z.object({
    kind: z.literal('error'),
    message: z.string(),
    suggestion: z.string().optional(),
  }),
])
export type TurnEvent = z.infer<typeof TurnEvent>

export const Turn = z.object({
  agentId: z.string(),
  artifactsTouched: z.array(z.string()).optional(),
  channelId: z.string(),
  endedAt: z.string().datetime().optional(),
  hostsContacted: z.array(z.string()).optional(),
  promptedBy: z.enum(['user', 'agent']).optional(),
  promptText: z.string(),
  startedAt: z.string().datetime(),
  state: TurnState,
  tokensUsed: z.number().int().nonnegative().optional(),
  toolCallCount: z.number().int().nonnegative().optional(),
  turnId: z.string(),
})
export type Turn = z.infer<typeof Turn>

export const LookbackPacket = z.object({
  channelId: z.string(),
  currentPrompt: z.string(),
  sharedArtifacts: z.array(z.object({
    factId: z.string(),
    path: z.string(),
    version: z.number().int(),
  })),
  sinceYourLastTurn: z.array(z.object({
    by: z.string(),
    kind: z.enum(['message', 'artifact', 'review', 'digest']),
    path: z.string().nullable(),
    summary: z.string(),
    turnId: z.string(),
  })),
  yourLastTurn: Turn.nullable(),
})
export type LookbackPacket = z.infer<typeof LookbackPacket>

export const IncludesConfig = z.object({
  refs: z.array(z.object({
    parleyConsentRef: z.string().optional(),
    treeId: z.string(),
  })),
})
export type IncludesConfig = z.infer<typeof IncludesConfig>
