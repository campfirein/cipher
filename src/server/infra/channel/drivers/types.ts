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
 * (channel, member) pair via `DriverPool`. Real ACP-backed drivers land in
 * Phase 2 (`./acp-driver.ts`); the in-tree mock at `./mock-driver.ts` covers
 * orchestrator unit tests.
 *
 * Cancel ownership is one-direction (Phase 2 review F2): the
 * `CancelCoordinator` calls `requestCancel()` then `forceClose()` directly.
 * Drivers must not call back into the coordinator.
 */
export interface ChannelAgentDriver {
  /** Subprocess teardown. SIGTERM with a 2s grace then SIGKILL. Idempotent. */
  forceClose(): Promise<void>
  /** Run a single turn. Streams TurnEvents that the orchestrator persists into the tree. */
  prompt(input: PromptInput): AsyncIterable<TurnEvent>
  /** Soft cancel of the in-flight turn. ACP-level (`session/cancel`) for `AcpDriver`. */
  requestCancel(): Promise<void>
}
