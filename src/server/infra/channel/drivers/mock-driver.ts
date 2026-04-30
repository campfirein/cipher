import type {TurnEvent} from '../../../core/domain/channel/types.js'
import type {ChannelAgentDriver, PromptInput} from './types.js'

/**
 * In-tree mock driver for orchestrator unit tests. The full BRV-208 fixture
 * (a real spawnable stdio ACP server using `@agentclientprotocol/sdk`) lands
 * later in Phase 1; this stub gives BRV-203 a deterministic in-process
 * driver to drive the state machine through real `prompt()` iteration.
 *
 * Behaviour selected via the `MockDriverOptions` constructor:
 *  - 'echo' (default): yields starting → message(echo) → done.
 *  - 'fail-after': yields starting → throws after `failAfterMs` ms.
 *  - 'stream': yields starting → N token chunks → done.
 */
export interface MockDriverOptions {
  failAfterMs?: number
  /** Optional sleep between events, in ms. Useful for interleaving tests. */
  pauseMs?: number
  scenario?: 'echo' | 'fail-after' | 'stream'
  streamChunks?: number
}

export class MockChannelAgentDriver implements ChannelAgentDriver {
  private cancelled = false

  constructor(private readonly options: MockDriverOptions = {}) {}

  public async cancel(): Promise<void> {
    this.cancelled = true
  }

  public async close(): Promise<void> {
    /* no-op for the in-tree stub. */
  }

  public async *prompt(input: PromptInput): AsyncIterable<TurnEvent> {
    const scenario = this.options.scenario ?? 'echo'

    yield {kind: 'status', status: 'starting'}
    await this.maybePause()

    if (this.cancelled) return

    if (scenario === 'fail-after') {
      const delay = this.options.failAfterMs ?? 10
      await sleep(delay)
      throw new Error(`mock-driver: fail-after-${delay}ms`)
    }

    if (scenario === 'stream') {
      const n = this.options.streamChunks ?? 5
      for (let i = 0; i < n; i++) {
        if (this.cancelled) return
        yield {delta: `chunk-${i} `, kind: 'token'}
        // eslint-disable-next-line no-await-in-loop -- sequential streaming is intentional
        await this.maybePause()
      }

      yield {content: `[streamed ${n} chunks for ${input.turnId}]`, kind: 'message', role: 'agent'}
      yield {kind: 'status', status: 'done'}
      return
    }

    // 'echo' default
    yield {content: `mock echo: ${input.prompt}`, kind: 'message', role: 'agent'}
    yield {kind: 'status', status: 'done'}
  }

  private async maybePause(): Promise<void> {
    if (this.options.pauseMs && this.options.pauseMs > 0) {
      await sleep(this.options.pauseMs)
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
