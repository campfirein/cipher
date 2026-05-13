import type {ChannelClient} from '@brv/channel-client'

import {z} from 'zod'

export const NAME = 'channel.show'
export const DESCRIPTION =
  'Read the full transcript of a single channel turn — every event in seq order. Useful for auditing past mentions or replaying what an agent said.'

export const inputSchema = {
  channelId: z.string(),
  turnId: z.string(),
}

export const inputSchemaZ = z.object(inputSchema).strict()

export type ShowInput = z.infer<typeof inputSchemaZ>

export type ShowOutput = {
  readonly turn: Record<string, unknown>
  readonly events: ReadonlyArray<Record<string, unknown>>
  readonly deliveries?: ReadonlyArray<Record<string, unknown>>
}

export const handler = async (
  input: ShowInput,
  deps: {readonly client: ChannelClient},
): Promise<ShowOutput> => {
  return deps.client.request<{channelId: string; turnId: string}, ShowOutput>(
    'channel:get-turn',
    {channelId: input.channelId, turnId: input.turnId},
  )
}
