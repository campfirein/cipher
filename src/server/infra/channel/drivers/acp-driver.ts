/* eslint-disable n/no-unsupported-features/node-builtins --
   Node engines.node is >=20 but we ship on >=22; the SDK's stream contract
   uses Web Stream APIs (Writable.toWeb / Readable.toWeb) that are stable in 22.x.
   Same pattern as `test/helpers/mock-acp-server.mjs`. */
import * as acp from '@agentclientprotocol/sdk'
import {type ChildProcessByStdio, spawn} from 'node:child_process'
import {type Readable as NodeReadable, type Writable as NodeWritable, Readable, Writable} from 'node:stream'

import type {AgentEntry, TurnEvent} from '../../../core/domain/channel/types.js'
import type {AcpEventProjector} from './acp-event-projector.js'
import type {PermissionBroker} from './permission-broker.js'
import type {ChannelAgentDriver, PromptInput} from './types.js'

import {AcpHandshakeError, AcpProtocolMismatchError, AgentNotInstalledError, NotImplementedError, PermissionDeniedError, TurnCancelledError} from '../../../core/domain/channel/errors.js'
import {AcpEventProjector as AcpEventProjectorImpl} from './acp-event-projector.js'

const FORCE_CLOSE_GRACE_MS = 2000

/**
 * Generic ACP-stdio driver for v1.
 *
 * Lifecycle (per Phase 2 plan §2.3 — F2 review fix):
 *  - `prompt()` lazily spawns the subprocess and runs `initialize` + `newSession`
 *    on first call; subsequent calls reuse the same session (one driver instance =
 *    one ACP session, owned by `DriverPool`).
 *  - `requestCancel()` issues `session/cancel` directly. No callback into a
 *    coordinator; the coordinator drives the soft→hard escalation by calling
 *    `forceClose()` after a grace window.
 *  - `forceClose()` is idempotent: SDK close → child SIGTERM → 2s grace → SIGKILL.
 */
export interface AcpDriverDeps {
  /** Channel id this driver instance is bound to (one driver per (channelId, agentId) pair via DriverPool). */
  channelId?: string
  cwd: string
  entry: AgentEntry
  /** Optional broker for ACP `permission/request` callbacks. Without one, requests default-deny. */
  permissionBroker?: PermissionBroker
  /** Optional projector override; used by tests. Production wiring constructs one per turn. */
  projectorFor?(turnId: string): AcpEventProjector
}

interface DriverContext {
  channelId?: string
  cwd: string
  permissionBroker?: PermissionBroker
}

interface ParsedTurnEvent {
  event: TurnEvent
}

export class AcpDriver implements ChannelAgentDriver {
  private cancelRequestedFor?: string
  private child?: ChildProcessByStdio<NodeWritable, NodeReadable, null>
  private childExited = false
  private closed = false
  private connection?: acp.ClientSideConnection
  private currentQueue?: TurnEventQueue
  private currentTurnId?: string
  /**
   * Codex re-review (round 3) Finding 2 — per-driver async mutex. The pool reuses a single
   * `AcpDriver` per `(channelId, agentId)` pair, so two concurrent `mention()` calls for the
   * same agent would otherwise both call `prompt()` on the same instance and overwrite the
   * `currentQueue`/`currentTurnId` singleton fields, routing ACP callbacks to the wrong queue.
   * The mutex serialises prompts; the second waits for the first to finish (preserving caller
   * ordering) rather than rejecting, since ACP sessions are inherently sequential.
   */
  private promptInflight?: Promise<void>
  private sessionId?: string

  public constructor(private readonly deps: AcpDriverDeps) {}

  /** Test helper: returns the active session id (or `undefined` before `prompt()`). */
  public debugSessionId(): string | undefined {
    return this.sessionId
  }

  /**
   * Internal callback target for ChannelClient — bridges ACP `permission/request`
   * to the broker. Without a broker (test setups), default-denies. Emits a
   * `permission_request` TurnEvent before parking so the orchestrator can
   * transition the turn to `awaiting_permission`.
   *
   * @internal
   */
  public async deliverPermissionRequest(params: acp.RequestPermissionRequest): Promise<acp.RequestPermissionResponse> {
    const turnId = this.currentTurnId
    const channelId = this.deps.channelId ?? ''
    const broker = this.deps.permissionBroker
    if (!broker || !turnId) {
      return {outcome: {optionId: 'deny', outcome: 'selected'}}
    }

    const queue = this.currentQueue
    queue?.pushEvent({
      kind: 'permission_request',
      permissionRequestId: params.toolCall.toolCallId,
      ...(params.toolCall.title ? {rationale: params.toolCall.title} : {}),
      toolName: params.toolCall.kind ?? 'unknown',
    })

    const resolved = await broker.parkAndAwait(turnId, channelId, params)
    // Codex re-review (round 3) Finding 1 — `denied` is derived from `PermissionOption.kind`, not
    // a literal `optionId === 'deny'` match. Vendor adapters use arbitrary IDs like
    // `reject_once_1`; only `kind` is portable.
    //
    // When denied, return the SDK response (so the agent terminates cleanly) AND poison the local
    // queue so our async iterator throws `PermissionDeniedError`. The orchestrator catches it and
    // applies `permission_decision: deny`, persisting the turn as `failed` per the state machine.
    if (resolved.denied) {
      queue?.endError(new PermissionDeniedError(turnId, params.toolCall.toolCallId))
    }

    return resolved.response
  }

  // Internal callback target for ChannelClient — pushes notifications into the active queue.
  /** @internal */
  public deliverSessionUpdate(update: acp.SessionNotification): void {
    this.currentQueue?.pushUpdate(update.update)
  }

  public async forceClose(): Promise<void> {
    if (this.closed) return
    this.closed = true
    const {child} = this
    this.child = undefined
    this.connection = undefined
    this.sessionId = undefined
    if (!child || this.childExited || child.exitCode !== null) return

    child.kill('SIGTERM')
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        // F6 review fix — `child.killed` becomes true once SIGTERM is signalled, not when the process
        // actually exits. Check our explicit `childExited` flag (set by the 'exit' listener) instead,
        // so SIGKILL fires for processes that ignore SIGTERM.
        if (!this.childExited) child.kill('SIGKILL')
        resolve()
      }, FORCE_CLOSE_GRACE_MS)
      child.once('exit', () => {
        this.childExited = true
        clearTimeout(timer)
        resolve()
      })
    })
  }

  /** Read-only flag the `DriverPool` checks before returning a cached driver. */
  public isClosed(): boolean {
    return this.closed
  }

  public async *prompt(input: PromptInput): AsyncIterable<TurnEvent> {
    // Codex re-review (round 3) Finding 2 — serialize concurrent prompts on the same driver.
    // Wait for any in-flight prompt to finish before claiming the singleton fields.
    while (this.promptInflight) {
      // eslint-disable-next-line no-await-in-loop -- intentional wait on a single fence
      await this.promptInflight
    }

    let signalDone: () => void = noop
    this.promptInflight = new Promise<void>((resolve) => { signalDone = resolve })

    if (this.closed) {
      signalDone()
      this.promptInflight = undefined
      throw new Error('AcpDriver is closed')
    }

    try {
      await this.ensureSession()
    } catch (error) {
      signalDone()
      this.promptInflight = undefined
      throw error
    }

    if (!this.connection || !this.sessionId) {
      signalDone()
      this.promptInflight = undefined
      throw new AcpHandshakeError(this.deps.entry.id, 'no active session after handshake')
    }

    const queue = new TurnEventQueue()
    this.currentQueue = queue
    this.currentTurnId = input.turnId
    const projector = this.deps.projectorFor?.(input.turnId) ?? new AcpEventProjectorImpl({turnId: input.turnId})

    queue.bindProjector(projector)

    // Drive the prompt in the background; events arrive via Client.sessionUpdate (see ChannelClient below)
    // and are pushed into the queue. The async generator drains the queue.
    const promptPromise = this.connection
      .prompt({prompt: [{text: input.prompt, type: 'text'}], sessionId: this.sessionId})
      .then((response) => {
        queue.endSuccess(response)
      })
      .catch((error) => {
        queue.endError(error instanceof Error ? error : new Error(String(error)))
      })

    try {
      while (true) {
        // eslint-disable-next-line no-await-in-loop -- sequential drain is intentional
        const next = await queue.next()
        if (next.kind === 'event') {
          yield next.event
          continue
        }

        if (next.kind === 'error') {
          // Codex re-review Finding 2 — if cancellation was requested for this turn (soft via
          // `requestCancel()` or hard via `forceClose()`), an SDK rejection coming through this
          // branch is the cancel-induced teardown, not a genuine driver failure. Convert it so the
          // orchestrator persists `state: 'cancelled'`, matching what `cancelByTurnId()` returns.
          // Permission-denied errors flow through here too — preserve their shape so the orchestrator
          // can apply `permission_decision: deny`.
          if (next.error instanceof PermissionDeniedError) throw next.error
          if (this.cancelRequestedFor === input.turnId) {
            throw new TurnCancelledError(input.turnId, next.error.message)
          }

          throw next.error
        }

        // 'end' — the prompt resolved. Codex F4 review fix: distinguish cancellation from completion.
        // The ACP server returns `stopReason: 'cancelled'` after `session/cancel`, OR our local
        // `cancelRequestedFor` flag was set before the prompt settled. Either way, surface as
        // `TurnCancelledError` so the orchestrator persists `state: 'cancelled'` instead of `completed`.
        // eslint-disable-next-line no-await-in-loop -- intentional final await
        await promptPromise
        const wasCancelled = this.cancelRequestedFor === input.turnId || next.response.stopReason === 'cancelled'
        if (wasCancelled) {
          throw new TurnCancelledError(input.turnId, next.response.stopReason ?? 'requested')
        }

        return
      }
    } finally {
      this.currentQueue = undefined
      this.currentTurnId = undefined
      if (this.cancelRequestedFor === input.turnId) this.cancelRequestedFor = undefined
      // Release the per-driver mutex so a queued prompt can proceed (Finding 2).
      signalDone()
      this.promptInflight = undefined
    }
  }

  public async requestCancel(): Promise<void> {
    this.cancelRequestedFor = this.currentTurnId
    if (!this.connection || !this.sessionId) return
    try {
      await this.connection.cancel({sessionId: this.sessionId})
    } catch {
      // The SDK may reject cancel on an already-settled session; that's fine — `forceClose` is the hard fallback.
    }
  }

  /**
   * Spawn + initialize + newSession. Idempotent: a second call after success is a no-op.
   * Failure modes:
   *  - ENOENT on spawn  → `AgentNotInstalledError`
   *  - subprocess exits before initialize completes → `AcpHandshakeError`
   *  - SDK initialize / newSession rejection → `AcpHandshakeError` wrapping the upstream message
   */
  private async ensureSession(): Promise<void> {
    if (this.sessionId) return
    if (this.deps.entry.launch.kind !== 'stdio') {
      throw new NotImplementedError(`launch kind '${this.deps.entry.launch.kind}'`)
    }

    const {args, command, env} = this.deps.entry.launch
    let child: ChildProcessByStdio<NodeWritable, NodeReadable, null>
    try {
      child = spawn(command, args, {
        cwd: this.deps.cwd,
        env: {...process.env, ...env},
        stdio: ['pipe', 'pipe', 'inherit'],
      })
    } catch (error) {
      throw wrapSpawnError(this.deps.entry, error)
    }

    // ENOENT can also surface asynchronously via the 'error' event on Node when the binary
    // isn't found; capture it via a once-shot listener that races initialize().
    const earlyExit = new Promise<never>((_resolve, reject) => {
      child.once('error', (err: NodeJS.ErrnoException) => {
        reject(wrapSpawnError(this.deps.entry, err))
      })
      child.once('exit', (code, signal) => {
        if (this.sessionId) return
        reject(new AcpHandshakeError(this.deps.entry.id, `subprocess exited before handshake (code=${code}, signal=${signal})`))
      })
    })

    // F6 review fix — track real exit (not just `child.killed`) so `forceClose` can SIGKILL
    // a process that ignores SIGTERM.
    this.childExited = false
    child.once('exit', () => {
      this.childExited = true
    })

    this.child = child

    try {
      const input = Writable.toWeb(child.stdin) as WritableStream<Uint8Array>
      const output = Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>
      const stream = acp.ndJsonStream(input, output)

      this.connection = new acp.ClientSideConnection(() => new ChannelClient(this), stream)

      const handshake = (async () => {
        const initResult = await this.connection!.initialize({
          clientCapabilities: {fs: {readTextFile: false, writeTextFile: false}},
          protocolVersion: acp.PROTOCOL_VERSION,
        })
        // Phase 2 review (Kimi B4) — fail fast on protocol drift instead of crashing later.
        if (initResult.protocolVersion !== acp.PROTOCOL_VERSION) {
          throw new AcpProtocolMismatchError(
            this.deps.entry.id,
            String(initResult.protocolVersion),
            String(acp.PROTOCOL_VERSION),
          )
        }

        const session = await this.connection!.newSession({cwd: this.deps.cwd, mcpServers: []})
        this.sessionId = session.sessionId
      })()

      await Promise.race([handshake, earlyExit])
    } catch (error) {
      await this.forceClose()
      if (
        error instanceof AcpHandshakeError ||
        error instanceof AcpProtocolMismatchError ||
        error instanceof AgentNotInstalledError
      ) throw error
      throw new AcpHandshakeError(this.deps.entry.id, error instanceof Error ? error.message : String(error))
    }
  }
}

/**
 * Factory dispatching on `AgentEntry.launch.kind`. Kept thin so wiring code can
 * delegate without re-implementing the dispatch.
 */
export function createDriver(entry: AgentEntry, ctx: DriverContext): ChannelAgentDriver {
  switch (entry.launch.kind) {
    case 'mock': {
      throw new NotImplementedError(`createDriver does not own mock-driver instantiation; use MockChannelAgentDriver directly`)
    }

    case 'stdio': {
      return new AcpDriver({
        ...(ctx.channelId ? {channelId: ctx.channelId} : {}),
        cwd: ctx.cwd,
        entry,
        ...(ctx.permissionBroker ? {permissionBroker: ctx.permissionBroker} : {}),
      })
    }

    case 'tcp': {
      throw new NotImplementedError(`launch kind 'tcp' (v1.1)`)
    }
  }
}

/**
 * Bridges the ACP `Client` callbacks into the active driver. Holds no state of
 * its own; everything goes through `AcpDriver.deliverSessionUpdate()` so the
 * active turn's queue receives the update.
 */
// eslint-disable-next-line import/namespace -- SDK re-export limitation, see ClientSideConnection note above
class ChannelClient implements acp.Client {
  public constructor(private readonly driver: AcpDriver) {}

  public async readTextFile(): Promise<acp.ReadTextFileResponse> {
    throw new Error('readTextFile not implemented in v1')
  }

  public async requestPermission(params: acp.RequestPermissionRequest): Promise<acp.RequestPermissionResponse> {
    return this.driver.deliverPermissionRequest(params)
  }

  public async sessionUpdate(params: acp.SessionNotification): Promise<void> {
    this.driver.deliverSessionUpdate(params)
  }

  public async writeTextFile(): Promise<acp.WriteTextFileResponse> {
    throw new Error('writeTextFile not implemented in v1')
  }
}

type QueueItem =
  | {error: Error; kind: 'error'}
  | {event: TurnEvent; kind: 'event'}
  | {kind: 'end'; response: acp.PromptResponse}

/**
 * Push-based async queue: ACP notifications come in via `pushUpdate`, the
 * driver's `prompt()` generator drains via `next()`. Single producer, single
 * consumer. Ends when the prompt resolves (`endSuccess`) or rejects (`endError`).
 */
class TurnEventQueue {
  private buffer: QueueItem[] = []
  private finished = false
  private projector?: AcpEventProjector
  private resolveNext?: (item: QueueItem) => void

  public bindProjector(projector: AcpEventProjector): void {
    this.projector = projector
  }

  public endError(error: Error): void {
    if (this.finished) return
    this.finished = true
    this.push({error, kind: 'error'})
  }

  public endSuccess(response: acp.PromptResponse): void {
    if (this.finished) return
    this.finished = true
    this.push({kind: 'end', response})
  }

  public next(): Promise<QueueItem> {
    if (this.buffer.length > 0) {
      const item = this.buffer.shift()!
      return Promise.resolve(item)
    }

    return new Promise<QueueItem>((resolve) => {
      this.resolveNext = resolve
    })
  }

  /** Direct event push (used for events not derivable from `session/update` — e.g. permission_request). */
  public pushEvent(event: TurnEvent): void {
    if (this.finished) return
    this.push({event, kind: 'event'})
  }

  public pushUpdate(update: acp.SessionNotification['update']): void {
    if (this.finished || !this.projector) return
    for (const event of this.projector.project(update)) {
      this.push({event, kind: 'event'})
    }
  }

  private push(item: QueueItem): void {
    if (this.resolveNext) {
      const resolve = this.resolveNext
      this.resolveNext = undefined
      resolve(item)
      return
    }

    this.buffer.push(item)
  }
}

function wrapSpawnError(entry: AgentEntry, error: unknown): Error {
  if (isErrnoException(error) && (error.code === 'ENOENT' || error.code === 'EACCES')) {
    const command = entry.launch.kind === 'stdio' ? entry.launch.command : entry.id
    return new AgentNotInstalledError(entry.id, `Install or place "${command}" on your PATH (Phase 4 doctor will automate this).`)
  }

  return new AcpHandshakeError(entry.id, error instanceof Error ? error.message : String(error))
}

function noop(): void {/* placeholder for the prompt-inflight resolver before it's bound */}

function isErrnoException(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && typeof (value as NodeJS.ErrnoException).code === 'string'
}

/** Type stand-in for `ParsedTurnEvent` (referenced in JSDoc). */
export type {ParsedTurnEvent}
