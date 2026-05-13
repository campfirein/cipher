import type {ChannelClient} from '@brv/channel-client'

import {z} from 'zod'

export const NAME = 'channel.doctor'
export const DESCRIPTION =
  'Probe every registered agent driver profile (or one specific profile via --profile) and report which ones can boot cleanly. Use BEFORE attempting an `channel.mention` if a profile is misconfigured.'

export const inputSchema = {
  profile: z
    .string()
    .optional()
    .describe('Optional profile name to probe; default probes every registered profile.'),
}

export const inputSchemaZ = z.object(inputSchema).strict()

export type DoctorInput = z.infer<typeof inputSchemaZ>

export type DoctorOutput = {
  readonly profiles: ReadonlyArray<{
    readonly name: string
    readonly ok: boolean
    readonly reason?: string
  }>
}

export const handler = async (
  input: DoctorInput,
  deps: {readonly client: ChannelClient},
): Promise<DoctorOutput> => {
  const payload: {profile?: string} = {}
  if (input.profile !== undefined) payload.profile = input.profile
  return deps.client.request<{profile?: string}, DoctorOutput>('channel:doctor', payload)
}
