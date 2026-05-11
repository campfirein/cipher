import type {ContentBlock, TurnEvent} from '../../../../shared/types/channel.js'

/**
 * Payload-only TurnEvent: the variant fields without the {@link TurnEventBase}
 * metadata (`channelId`, `turnId`, `deliveryId`, `memberHandle`, `emittedAt`,
 * `seq`). The orchestrator wraps each payload with TurnEventBase + the seq
 * from the per-turn sequence allocator before persisting. This keeps the
 * driver oblivious to channel-side metadata.
 */
export type TurnEventPayload = TurnEvent extends infer T
  ? T extends TurnEvent
    ? Omit<T, 'channelId' | 'deliveryId' | 'emittedAt' | 'memberHandle' | 'seq' | 'turnId'>
    : never
  : never

export type AcpDriverPromptArgs = {
  readonly meta?: Record<string, unknown>
  readonly prompt: ContentBlock[]
  readonly turnId: string
}

export type AcpDriverStatus = 'errored' | 'idle' | 'stopped' | 'streaming'

/**
 * ACP driver contract (DESIGN.md §5.3 + IMPLEMENTATION_PHASE_2.md Slice 2.2).
 *
 * Lifecycle:
 *  - `start()` spawns the child, runs ACP `initialize` synchronously, and
 *    caches `protocolVersion` + `capabilities`. The promise rejects with
 *    {@link AcpHandshakeFailedError} on a failed handshake. Once start
 *    resolves, the driver is ready to serve prompts.
 *  - `prompt()` lazily creates an ACP session on the first call (and reuses
 *    it for subsequent calls) then dispatches one turn. Returns an
 *    AsyncIterable of payload-only TurnEvents.
 *  - `respondToPermission()` resolves a pending server-initiated
 *    `session/request_permission`.
 *  - `cancel()` sends ACP `session/cancel` for the in-flight prompt;
 *    subsequent prompts still work.
 *  - `stop()` terminates the child (graceful → SIGTERM → SIGKILL).
 */
export interface IAcpDriver {
  cancel(turnId?: string): Promise<void>
  readonly capabilities: string[]
  readonly handle: string
  prompt(args: AcpDriverPromptArgs): AsyncIterableIterator<TurnEventPayload>
  readonly protocolVersion: number | undefined
  respondToPermission(permissionRequestId: string, response: unknown): Promise<void>
  start(): Promise<void>
  readonly status: AcpDriverStatus
  stop(): Promise<void>
}
