import {zodToJsonSchema} from 'zod-to-json-schema'

import {
  AgentEntry,
  ChannelMeta,
  IncludesConfig,
  LookbackPacket,
  Turn,
  TurnEvent,
} from './types.js'

export const channelMetaJsonSchema = zodToJsonSchema(ChannelMeta, 'ChannelMeta')
export const turnJsonSchema = zodToJsonSchema(Turn, 'Turn')
export const turnEventJsonSchema = zodToJsonSchema(TurnEvent, 'TurnEvent')
export const lookbackPacketJsonSchema = zodToJsonSchema(LookbackPacket, 'LookbackPacket')
export const includesConfigJsonSchema = zodToJsonSchema(IncludesConfig, 'IncludesConfig')
export const agentEntryJsonSchema = zodToJsonSchema(AgentEntry, 'AgentEntry')

export const channelJsonSchemaFiles = {
  'agent-entry.json': agentEntryJsonSchema,
  'channel-meta.json': channelMetaJsonSchema,
  'includes-config.json': includesConfigJsonSchema,
  'lookback-packet.json': lookbackPacketJsonSchema,
  'turn-event.json': turnEventJsonSchema,
  'turn.json': turnJsonSchema,
}

export {
  AcpLaunchSpec,
  AgentEntry,
  AgentRole,
  ChannelMember,
  ChannelMeta,
  ChannelStatus,
  IncludesConfig,
  LookbackPacket,
  Turn,
  TurnEvent,
  TurnState,
  TurnTransitionEvent,
} from './types.js'

export type {
  AcpLaunchSpec as AcpLaunchSpecT,
  AgentEntry as AgentEntryT,
  AgentRole as AgentRoleT,
  ChannelMember as ChannelMemberT,
  ChannelMeta as ChannelMetaT,
  ChannelStatus as ChannelStatusT,
  IncludesConfig as IncludesConfigT,
  LookbackPacket as LookbackPacketT,
  TurnEvent as TurnEventT,
  TurnState as TurnStateT,
  Turn as TurnT,
  TurnTransitionEvent as TurnTransitionEventT,
} from './types.js'
