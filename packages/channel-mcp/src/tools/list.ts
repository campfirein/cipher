import type {ChannelClient} from '@brv/channel-client'

import {z} from 'zod'

export const NAME = 'channel.list'
export const DESCRIPTION =
  'List the brv channels visible from the current project. Returns each channel\'s id, member count, and state.'

export const inputSchema = {}
export const inputSchemaZ = z.object({}).strict()

export type ListInput = z.infer<typeof inputSchemaZ>

type ChannelSummary = {
  readonly channelId: string
  readonly memberCount: number
  readonly members: ReadonlyArray<{readonly handle: string; readonly status?: string}>
  readonly title?: string
  readonly updatedAt: string
  readonly archivedAt?: string
}

export type ListOutput = {
  readonly channels: ChannelSummary[]
}

export const handler = async (
  _input: ListInput,
  deps: {readonly client: ChannelClient},
): Promise<ListOutput> => {
  const result = await deps.client.request<unknown, {channels: ChannelSummary[]}>('channel:list', {})
  return {channels: result.channels}
}
