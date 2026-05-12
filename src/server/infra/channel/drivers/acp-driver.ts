import type {ChildProcessWithoutNullStreams} from 'node:child_process'

import {spawn} from 'node:child_process'

import type {
  AcpDriverPromptArgs,
  AcpDriverStatus,
  IAcpDriver,
  TurnEventPayload,
} from '../../../core/interfaces/channel/i-acp-driver.js'

import {AcpHandshakeFailedError} from '../../../core/domain/channel/errors.js'
import {projectSessionUpdate} from './acp-event-projector.js'
import {AcpRpcClient, AcpRpcError} from './acp-rpc-client.js'

export type AcpDriverInvocation = {
  readonly args: string[]
  readonly command: string
  readonly cwd: string
  readonly env?: Record<string, string>
}

export type AcpDriverOptions = {
  readonly handle: string
  readonly invocation: AcpDriverInvocation
}



type SessionUpdateNotification = {
  sessionId: string
  update: {[k: string]: unknown; sessionUpdate: string;}
}

type PermissionContext = {
  reject(error: unknown): void
  resolve(response: unknown): void
}

type PromptQueueState = {
  done: boolean
  queue: TurnEventPayload[]
  resolveNext: (() => void) | undefined
}

async function* iteratePromptQueue(
  state: PromptQueueState,
  promptPromise: Promise<unknown>,
): AsyncGenerator<TurnEventPayload> {
  while (state.queue.length > 0 || !state.done) {
    if (state.queue.length > 0) {
      const event = state.queue.shift()
      if (event !== undefined) yield event
      continue
    }

    // eslint-disable-next-line no-await-in-loop
    await new Promise<void>((resolve) => {
      state.resolveNext = resolve
    })
  }

  await promptPromise
}

/**
 * Subprocess-driven ACP driver.
 *
 * Wires a Node `child_process` spawn to {@link AcpRpcClient} via NDJSON
 * framing. Owns the agent's `initialize` handshake, lazy `session/new`,
 * and per-turn `session/prompt` lifecycle. Projects `session/update`
 * notifications to payload-only {@link TurnEventPayload}.
 */
export class AcpDriver implements IAcpDriver {
  public acpInitialize: import('../../../core/interfaces/channel/i-acp-driver.js').AcpInitializeSnapshot | undefined
  public capabilities: string[] = []
  public readonly handle: string
  public protocolVersion: number | undefined
  public status: AcpDriverStatus = 'idle'
  private child: ChildProcessWithoutNullStreams | undefined
  private readonly invocation: AcpDriverInvocation
  private pendingPermissions = new Map<string, PermissionContext>()
  private rpc: AcpRpcClient | undefined
  private sessionId: string | undefined

  public constructor(options: AcpDriverOptions) {
    this.handle = options.handle
    this.invocation = options.invocation
  }

  async cancel(_turnId?: string): Promise<void> {
    if (this.rpc === undefined || this.sessionId === undefined) return
    try {
      await this.rpc.call('session/cancel', {sessionId: this.sessionId})
    } catch {
      // session/cancel is best-effort; the child may already be exiting.
    }

    // Resolve any pending permission contexts with a cancellation outcome so
    // the iterator unblocks cleanly.
    for (const ctx of this.pendingPermissions.values()) {
      ctx.resolve({outcome: {outcome: 'cancelled'}})
    }

    this.pendingPermissions.clear()
  }

  /**
   * Phase-3 onboarding probe: explicitly attempt ACP `session/new` and
   * report whether it succeeded. The driver does NOT keep the probed
   * session — it is closed (by not being referenced) so the next
   * `prompt()` call starts a fresh session.
   *
   * Returns `false` on any error response so the onboard classifier can
   * tag the driver as `C-prime` instead of `B`.
   */
  async probeSession(): Promise<boolean> {
    if (this.rpc === undefined) return false
    try {
      const result = (await this.rpc.call('session/new', {})) as {sessionId?: string}
      return typeof result?.sessionId === 'string' && result.sessionId.length > 0
    } catch {
      return false
    }
  }

  prompt(args: AcpDriverPromptArgs): AsyncIterableIterator<TurnEventPayload> {
    if (this.rpc === undefined) {
      throw new Error('AcpDriver: prompt() called before start() resolved')
    }

    const {rpc} = this
    const ensureSession = async (): Promise<string> => {
      if (this.sessionId !== undefined) return this.sessionId
      const result = (await rpc.call('session/new', {
        cwd: this.invocation.cwd,
        mcpServers: [],
      })) as {sessionId: string}
      this.sessionId = result.sessionId
      return result.sessionId
    }

    const state: PromptQueueState = {done: false, queue: [], resolveNext: undefined}
    const wakeup = (): void => {
      if (state.resolveNext !== undefined) {
        const r = state.resolveNext
        state.resolveNext = undefined
        r()
      }
    }

    rpc.onNotification('session/update', (params) => {
      const note = params as SessionUpdateNotification
      const event = projectSessionUpdate(note.update)
      if (event !== undefined) {
        state.queue.push(event)
        wakeup()
      }
    })

    rpc.onRequest('session/request_permission', (params) =>
      new Promise<unknown>((resolve, reject) => {
        const req = params as {options: unknown[]; sessionId: string; toolCall: unknown}
        const id = `acp-perm-${this.pendingPermissions.size + 1}-${Date.now()}`
        this.pendingPermissions.set(id, {reject, resolve})
        state.queue.push({
          kind: 'permission_request',
          permissionRequestId: id,
          request: req,
        } as TurnEventPayload)
        wakeup()
      }),
    )

    return iteratePromptQueue(state, this.dispatchPrompt({args, ensureSession, rpc, state, wakeup}))
  }

  async respondToPermission(permissionRequestId: string, response: unknown): Promise<void> {
    const ctx = this.pendingPermissions.get(permissionRequestId)
    if (ctx === undefined) return
    this.pendingPermissions.delete(permissionRequestId)
    ctx.resolve(response)
  }

  async start(): Promise<void> {
    const env = {...process.env, ...this.invocation.env}
    const child = spawn(this.invocation.command, this.invocation.args, {
      cwd: this.invocation.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams
    this.child = child

    let closed = false
    const rpc = new AcpRpcClient({
      onClose(handler) {
        child.on('close', () => {
          closed = true
          handler()
        })
      },
      onLine() {
        // ingest() drives the decoder directly; this hook isn't used.
      },
      send(line) {
        if (!closed && child.stdin.writable) {
          child.stdin.write(line)
        }
      },
    })
    child.stdout.on('data', (chunk: Buffer) => {
      rpc.ingest(chunk)
    })
    child.stderr.on('data', () => {
      // Drain; surface as ERROR log when we wire it up.
    })

    this.rpc = rpc

    try {
      const result = (await rpc.call('initialize', {
        clientCapabilities: {},
        protocolVersion: 1,
      })) as {
        _meta?: Record<string, unknown>
        agentCapabilities?: {
          promptCapabilities?: Record<string, boolean>
          toolCallSupport?: boolean
        }
        protocolVersion: number
      }
      this.protocolVersion = result.protocolVersion
      this.acpInitialize = {_meta: result._meta, agentCapabilities: result.agentCapabilities}
      const promptCaps = result.agentCapabilities?.promptCapabilities ?? {}
      this.capabilities = Object.entries(promptCaps)
        .filter(([, v]) => v === true)
        .map(([k]) => k)
      if (result.agentCapabilities?.toolCallSupport === true) this.capabilities.push('toolCallSupport')
    } catch (error) {
      this.status = 'errored'
      await this.stop()
      const reason = error instanceof Error ? error.message : String(error)
      throw new AcpHandshakeFailedError(this.handle, reason)
    }
  }

  async stop(): Promise<void> {
    this.status = 'stopped'
    const {child} = this
    if (child === undefined) return
    this.child = undefined

    if (child.exitCode !== null || child.killed) return

    return new Promise<void>((resolve) => {
      const onExit = (): void => {
        clearTimeout(killTimer)
        resolve()
      }

      child.once('exit', onExit)

      // Try graceful close: close stdin → SIGTERM after 1s → SIGKILL after 5s.
      try {
        child.stdin.end()
      } catch {
        // Already closed.
      }

      const termTimer = setTimeout(() => {
        try {
          child.kill('SIGTERM')
        } catch {
          // Already gone.
        }
      }, 1000)
      const killTimer = setTimeout(() => {
        clearTimeout(termTimer)
        try {
          child.kill('SIGKILL')
        } catch {
          // Already gone.
        }
      }, 5000)
    })
  }

  private async dispatchPrompt(deps: {
    args: AcpDriverPromptArgs
    ensureSession: () => Promise<string>
    rpc: AcpRpcClient
    state: PromptQueueState
    wakeup: () => void
  }): Promise<void> {
    const sessionId = await deps.ensureSession()
    try {
      await deps.rpc.call('session/prompt', {
        ...deps.args.meta,
        prompt: deps.args.prompt,
        sessionId,
      })
    } catch (error) {
      // Non-cancellation errors mark the driver `errored`; the iterator
      // surfaces them via its trailing `await promptPromise`.
      if (!(error instanceof AcpRpcError)) {
        this.status = 'errored'
        throw error
      }
    } finally {
      deps.state.done = true
      deps.wakeup()
    }
  }
}

export {AcpHandshakeFailedError} from '../../../core/domain/channel/errors.js'