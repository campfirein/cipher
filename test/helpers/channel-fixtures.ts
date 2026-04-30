import type {
  AgentEntryT,
  ChannelMetaT,
  IncludesConfigT,
  LookbackPacketT,
  TurnEventT,
  TurnT,
} from '../../src/server/core/domain/channel/schemas.js'

const createdAt = '2026-04-30T00:00:00.000Z'
const startedAt = '2026-04-30T00:00:01.000Z'
const endedAt = '2026-04-30T00:00:02.000Z'

export const mockAgentEntryFixture: AgentEntryT = {
  displayName: 'Mock A',
  id: 'mock-a',
  launch: {
    kind: 'mock',
    mockId: 'echo',
  },
  role: 'coding-agent',
}

export const channelMetaFixture: ChannelMetaT = {
  channelId: 'ping-pong',
  createdAt,
  members: [
    {
      agentId: 'mock-a',
      joinedAt: createdAt,
      status: 'idle',
    },
  ],
  scope: 'project',
  status: 'active',
  treeRoot: '/tmp/byterover/project',
  turnCount: 1,
}

export const turnFixture: TurnT = {
  agentId: 'mock-a',
  channelId: 'ping-pong',
  endedAt,
  promptText: 'hello',
  startedAt,
  state: 'completed',
  turnId: 't-001',
}

export const turnEventFixtures: TurnEventT[] = [
  {kind: 'status', status: 'starting'},
  {delta: 'hello', kind: 'token'},
  {content: 'hello', kind: 'message', role: 'agent'},
  {bytes: 12, kind: 'artifact', path: 'notes/plan.md', summary: 'Wrote plan'},
  {
    bytesEstimate: 12,
    contentHash: 'sha256:abc123',
    kind: 'artifact_intent',
    path: 'notes/plan.md',
  },
  {
    kind: 'permission_request',
    permissionRequestId: 'perm-001',
    toolName: 'write_file',
  },
  {kind: 'tool', latencyMs: 12, name: 'read_file', ok: true},
  {kind: 'error', message: 'mock failure', suggestion: 'retry'},
]

export const lookbackPacketFixture: LookbackPacketT = {
  channelId: 'ping-pong',
  currentPrompt: 'next prompt',
  sharedArtifacts: [
    {
      factId: 'fact-001',
      path: 'notes/plan.md',
      version: 1,
    },
  ],
  sinceYourLastTurn: [
    {
      by: '@mock-b',
      kind: 'message',
      path: null,
      summary: 'Mock B replied',
      turnId: 't-002',
    },
    {
      by: '@system',
      kind: 'digest',
      path: 'channel/ping-pong/digests/digest-1.md',
      summary: 'Digest of older turns',
      turnId: 'digest-1',
    },
  ],
  yourLastTurn: turnFixture,
}

export const includesConfigFixture: IncludesConfigT = {
  refs: [],
}
