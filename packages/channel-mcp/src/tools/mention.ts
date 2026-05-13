import type {ChannelClient, ChannelMentionSyncResponse} from '@brv/channel-client'

import {z} from 'zod'

export const NAME = 'channel.mention'
export const DESCRIPTION =
  'Mention agent members in a brv channel and block until the turn completes, returning the assembled final answer. ' +
  'Always uses sync mode; the tool intentionally does NOT expose stream mode (use the SDK directly if you need live token deltas). ' +
  'Defaults to suppressThoughts=true because the agent-driven use case never wants the reasoning trace; pass false to debug.'

// `mode` is intentionally NOT in the input schema — the tool always
// forces sync mode and returns the assembled answer. Callers wanting
// the stream surface drop down to `@brv/channel-client` directly.
export const inputSchema = {
  channelId: z.string().describe('Channel handle (e.g. "pi-review")'),
  prompt: z.string().describe('Prompt text — may contain @mentions'),
  suppressThoughts: z
    .boolean()
    .optional()
    .describe('Default true. Drops agent_thought_chunk events at the daemon. Set false to debug.'),
  timeout: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Sync-mode timeout in milliseconds. Daemon default is 300_000 (5 minutes).'),
}

export const inputSchemaZ = z.object(inputSchema).strict()

export type MentionInput = z.infer<typeof inputSchemaZ>

export const handler = async (
  input: MentionInput,
  deps: {readonly client: ChannelClient},
): Promise<ChannelMentionSyncResponse> => {
  const payload: {
    channelId: string
    mode: 'sync'
    prompt: string
    suppressThoughts: boolean
    timeout?: number
  } = {
    channelId: input.channelId,
    mode: 'sync',
    prompt: input.prompt,
    suppressThoughts: input.suppressThoughts ?? true,
  }
  if (input.timeout !== undefined) payload.timeout = input.timeout
  return deps.client.request<typeof payload, ChannelMentionSyncResponse>('channel:mention', payload)
}
