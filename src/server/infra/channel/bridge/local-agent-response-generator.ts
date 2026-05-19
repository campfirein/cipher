import {type IAcpDriver, type TurnEventPayload} from '../../../core/interfaces/channel/i-acp-driver.js'
import {type IDriverProfileStore} from '../../../core/interfaces/channel/i-driver-profile-store.js'
import {
  type ParleyResponseDataChunk,
  ParleyResponseError,
  type ParleyResponseGenerator,
} from './parley-response-generator.js'

/**
 * Phase 9 / Slice 9.4c — Parley response dispatcher that drives a
 * real local ACP agent on Bob's side.
 *
 * Replaces the slice 9.3/9.4a mock-echo behaviour when the daemon's
 * `BRV_BRIDGE_PARLEY_PROFILE` env names a Phase-3 driver-profile.
 * Each inbound Parley query spawns a fresh ACP subprocess via the
 * existing `driverFactory`, runs the prompt to completion, and
 * streams any `agent_message_chunk` / `agent_thought_chunk` events
 * back as Parley response chunks. The parley-server handles seq
 * assignment + signed terminal/seal at the wire layer.
 *
 * Slice 9.4c scope:
 *   - Read-only text Q&A only. Tool calls / permission requests are
 *     surfaced as agent_thought_chunks (best-effort) but not
 *     auto-approved or rejected — slice 9.9 wires the cross-bridge
 *     permission flow.
 *   - One driver per envelope, no pooling. Bob's daemon pays a per-
 *     query subprocess-spawn cost. Slice 9.4d will introduce a warm
 *     driver pool keyed on profile name.
 *   - Driver errors propagate as `PARLEY_LOCAL_AGENT_ERROR` strings;
 *     parley-server projects them as signed `error` terminal frames.
 */

export interface LocalAgentResponseGeneratorDeps {
  readonly driverFactory: (
    invocation: {
      readonly args: string[]
      readonly command: string
      readonly cwd: string
      readonly env?: Record<string, string>
    },
    handle: string,
  ) => IAcpDriver
  readonly profileName: string
  readonly profileStore: IDriverProfileStore
}

// Internal handle for the bridge dispatcher's ACP driver. It is never
// registered in any `ChannelMember` pool, so `dispatchMention` cannot
// resolve to it from a local channel (kimi round-1 LOW — confirmed).
const LOCAL_HANDLE = '@bridge-parley-handler'

export function createLocalAgentResponseGenerator(deps: LocalAgentResponseGeneratorDeps): ParleyResponseGenerator {
  // Each invocation spawns its own isolated driver; concurrent inbound
  // queries on Bob's daemon are safe but spawn N subprocesses. Slice
  // 9.4d will introduce profile-keyed pooling + a concurrency cap
  // (TODO(9.4d) — see kimi round-1 LOW-C).
  return async function* ({envelope}) {
    const profile = await deps.profileStore.get(deps.profileName)
    if (profile === undefined) {
      throw new ParleyResponseError(
        'PARLEY_LOCAL_AGENT_PROFILE_MISSING',
        `BRV_BRIDGE_PARLEY_PROFILE="${deps.profileName}" does not exist in the driver-profile registry`,
      )
    }

    const driver = deps.driverFactory(profile.invocation, LOCAL_HANDLE)
    try {
      await driver.start()
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      throw new ParleyResponseError('PARLEY_LOCAL_AGENT_START_FAILED', msg)
    }

    try {
      const promptBlocks = envelope.prompt.map((b) => ({
        text: b.text,
        type: 'text' as const,
      }))

      for await (const payload of driver.prompt({prompt: promptBlocks, turnId: envelope.turn_id})) {
        const chunk = projectPayload(payload)
        if (chunk !== undefined) yield chunk
      }
    } finally {
      await driver.stop().catch(() => {})
    }
  }
}

/**
 * Project a `TurnEventPayload` (which carries the full discriminated
 * union of ACP events) into a Parley response data chunk. Only text
 * chunks + agent thoughts flow through in 9.4c; everything else
 * (tool calls, permission requests, etc.) is dropped at this seam.
 *
 * Future slices will widen the data-chunk vocabulary to carry
 * tool-call frames + permission-request frames.
 */
// Must stay in sync with `ParleyResponseDataChunk` — when 9.9 adds
// tool-call / permission-request frames to the chunk vocabulary, this
// projection widens with new branches.
function projectPayload(payload: TurnEventPayload): ParleyResponseDataChunk | undefined {
  if (payload.kind === 'agent_message_chunk') {
    return {content: payload.content, kind: 'agent_message_chunk'}
  }

  if (payload.kind === 'agent_thought_chunk') {
    return {content: payload.content, kind: 'agent_thought_chunk'}
  }

  // Surface dropped payloads at debug level so an operator debugging a
  // silent gap on the wire can correlate (kimi round-1 MEDIUM).
   
  console.debug(`[parley] dropping unprojected payload kind: ${payload.kind}`)
  return undefined
}
