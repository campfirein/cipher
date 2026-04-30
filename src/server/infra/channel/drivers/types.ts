import type {LookbackPacket, TurnEvent} from '../../../core/domain/channel/types.js'

export interface PromptInput {
  channelId: string
  /** Channel state diff since this agent's last turn (per §3.6 of the design). */
  lookback: LookbackPacket
  /** Mention-stripped prompt body. */
  prompt: string
  turnId: string
}

/**
 * Per-channel, per-agent driver. The orchestrator owns one instance per
 * (channel, member) pair. Real ACP-backed drivers land in Phase 2; the
 * Phase 1 mock implementation lives at `./mock-driver.ts`.
 */
export interface ChannelAgentDriver {
  /** Best-effort cancel of the in-flight turn. Some transports can only kill the subprocess. */
  cancel(): Promise<void>
  /** Tear down the underlying connection / subprocess. Called on channel close or daemon shutdown. */
  close(): Promise<void>
  /** Run a single turn. Streams TurnEvents that the orchestrator persists into the tree. */
  prompt(input: PromptInput): AsyncIterable<TurnEvent>
}
