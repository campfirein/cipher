import {Args, Command, Flags} from '@oclif/core'

import type {
  ChannelGetTurnRequest,
  ChannelGetTurnResponse,
} from '../../../shared/transport/events/channel-events.js'
import type {TurnEvent} from '../../../shared/types/channel.js'

import {ChannelEvents} from '../../../shared/transport/events/channel-events.js'
import {ChannelClientError, connectChannelClient} from '../../lib/channel-client.js'
import {parseCommaSet} from '../../lib/channel-subscribe-helpers.js'
import {ChannelSubscribeRouter} from '../../lib/channel-subscribe-router.js'

// Slice 8.9 — push-model pub/sub command. Host LLMs (Claude Code, Codex, kimi,
// opencode, pi) spawn this as a long-lived subprocess; it streams filtered
// TurnEvents as newline-delimited JSON to stdout and exits when a bounded
// trigger fires (--count, --exit-on-terminal, --timeout, SIGINT, or socket
// disconnect). MetaGPT-style subscribe-by-interest via --roles / --kinds.
//
// Ordering (codex plan-review P1 + impl-review high-2):
//   connect → register listener → join room → replay → drain live-buffer → live
// The live listener is registered BEFORE the room is joined so no broadcast is
// lost in the join-ack/listener-register gap. While replay is walking history,
// live events are queued in a buffer instead of being emitted directly — this
// guarantees stdout (and lastSeen) is monotonic per-turn even when live events
// arrive mid-replay. After replay finishes, the buffer is drained (each event
// deduped against `printed` via replayDedupKey), and subsequent live events
// flow through directly.

export default class ChannelSubscribe extends Command {
  public static args = {
    channelId: Args.string({description: 'Channel handle', required: true}),
  }
public static description = `Subscribe to a channel and stream filtered events as newline-delimited JSON.

Push-model alternative to polling 'brv channel show'. Host LLMs read stdout
line by line in a tool-call loop — no polling. Exits when --count matching
terminal delivery events have arrived, --exit-on-terminal fires on any turn
reaching completed/cancelled, --timeout elapses, or SIGINT/SIGTERM is
received.

Ordering: the live listener is registered before the channel room is joined,
so no broadcast is lost in the gap between join-ack and listener-register.
When --turn + --after-seq are provided, historical events (seq > afterSeq)
are replayed AFTER joining the room; live events received during replay are
buffered and drained after replay completes. (turnId, seq) dedups events seen
via both paths.

--exit-on-terminal fires on ANY turn reaching a terminal state — turn-level
events (turn_state_change) bypass the --roles filter by design. To wait for
one specific member to finish their delivery, use:
  --roles @member --kinds delivery_state_change --count 1`
public static examples = [
    {
      command: '<%= config.bin %> <%= command.id %> my-review --exit-on-terminal',
      description: 'Wait for the next turn in this channel to reach completed/cancelled',
    },
    {
      command: '<%= config.bin %> <%= command.id %> my-review --roles @codex --kinds delivery_state_change --count 1',
      description: 'Wait specifically for @codex to finish one delivery (role-scoped completion)',
    },
    {
      command: '<%= config.bin %> <%= command.id %> my-review --roles @codex,@kimi --count 2 --kinds delivery_state_change',
      description: 'Quorum: wait for both reviewers to each finish, then exit',
    },
    {
      command: '<%= config.bin %> <%= command.id %> my-review --turn 28gdBaj... --after-seq 12',
      description: 'Crash-recovery: replay events for one turn with seq > 12, then continue live',
    },
  ]
public static flags = {
    'after-seq': Flags.integer({
      description: 'Skip events with seq <= this value within --turn (exclusive crash cursor)',
    }),
    count: Flags.integer({
      description: 'Exit after N unique (turnId, memberHandle) terminal delivery events',
      min: 1,
    }),
    'exit-on-terminal': Flags.boolean({
      default: false,
      description: 'Exit when ANY turn reaches completed/cancelled (turn-level; ignores --roles)',
    }),
    json: Flags.boolean({
      allowNo: true,
      default: true,
      description: 'Emit one JSON object per line (default; --no-json renders a terse trace)',
    }),
    kinds: Flags.string({
      description: 'Comma-separated event kinds (e.g. turn_state_change,delivery_state_change)',
    }),
    roles: Flags.string({
      description: 'Comma-separated member handles (e.g. @codex,@kimi); omit to receive all members',
    }),
    timeout: Flags.integer({
      default: 300_000,
      description: 'Hard timeout in ms; exit non-zero on timeout',
      min: 1,
    }),
    turn: Flags.string({
      description: 'Scope to a specific turnId (required when --after-seq is set)',
    }),
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(ChannelSubscribe)

    if (flags['after-seq'] !== undefined && flags.turn === undefined) {
      this.logToStderr('[CHANNEL_INVALID_FLAGS] --after-seq requires --turn (seq is per-turn monotonic)')
      this.exit(1)
    }

    const filter = {
      kinds: parseCommaSet(flags.kinds),
      roles: parseCommaSet(flags.roles),
      turn: flags.turn,
    }
    const afterSeq = flags['after-seq']
    const willReplay = flags.turn !== undefined && afterSeq !== undefined

    const client = await connectChannelClient()
    let resolveDone: ((reason: 'count' | 'disconnect' | 'signal' | 'terminal' | 'timeout') => void) | undefined
    let resolved = false
    const done = new Promise<'count' | 'disconnect' | 'signal' | 'terminal' | 'timeout'>((resolve) => {
      resolveDone = (reason) => {
        if (resolved) return
        resolved = true
        resolve(reason)
      }
    })
    let disconnectReason: string | undefined

    const router = new ChannelSubscribeRouter({
      count: flags.count,
      exitOnTerminal: flags['exit-on-terminal'],
      filter,
      onEmit: (event) => {
        if (flags.json) {
          this.log(JSON.stringify(event))
        } else {
          this.log(
            `[${event.turnId}#${event.seq}] ${event.memberHandle ?? '@you'} ${event.kind}`,
          )
        }
      },
      onTerminate: (reason) => resolveDone?.(reason),
    })

    try {
      // Step 1: register the live listener BEFORE joining the room. While
      // the router is in `replaying` mode, the live listener pushes to its
      // buffer; the drain in step 4 flushes the buffer deduped.
      if (willReplay) router.beginReplay()
      const offTurnEvent = client.on<{channelId: string; event: TurnEvent}>(
        ChannelEvents.TURN_EVENT,
        (data) => {
          if (data.channelId !== args.channelId) return
          router.pushLive(data.event)
        },
      )

      const offDisconnect = client.on<string>('disconnect', (reason) => {
        disconnectReason = typeof reason === 'string' ? reason : 'unknown'
        resolveDone?.('disconnect')
      })

      // Step 2: enter the channel room. The room-join ack is the cutoff
      // between "must replay" and "arrives live".
      await client.subscribe(args.channelId)

      // Step 3: optional historical replay scoped to --turn + --after-seq.
      if (willReplay && afterSeq !== undefined && flags.turn !== undefined) {
        const turn = await client.request<ChannelGetTurnRequest, ChannelGetTurnResponse>(
          ChannelEvents.GET_TURN,
          {channelId: args.channelId, turnId: flags.turn},
        )
        for (const event of turn.events) {
          if (router.isTerminated()) break
          if (event.seq <= afterSeq) continue
          router.pushReplay(event)
        }
      }

      // Step 4: drain the live buffer accumulated during replay, then flip
      // out of replaying mode so subsequent live events emit directly.
      router.finishReplay()

      // Step 5: bounded wait — termination, timeout, or signal.
      const timeoutTimer = router.isTerminated()
        ? undefined
        : setTimeout(() => resolveDone?.('timeout'), flags.timeout)
      const onSignal = (): void => resolveDone?.('signal')
      process.once('SIGINT', onSignal)
      process.once('SIGTERM', onSignal)

      const reason = await done
      if (timeoutTimer !== undefined) clearTimeout(timeoutTimer)
      process.off('SIGINT', onSignal)
      process.off('SIGTERM', onSignal)
      offTurnEvent()
      offDisconnect()

      if (reason === 'disconnect') {
        this.log(
          JSON.stringify({
            control: 'disconnected',
            lastSeen: router.lastSeen(),
            reason: disconnectReason ?? 'unknown',
          }),
        )
        await client.unsubscribe(args.channelId).catch(() => {})
        this.exit(1)
      }

      if (reason === 'timeout') {
        this.logToStderr(`[CHANNEL_SUBSCRIBE_TIMEOUT] No terminal trigger within ${flags.timeout}ms`)
        await client.unsubscribe(args.channelId).catch(() => {})
        this.exit(1)
      }

      await client.unsubscribe(args.channelId).catch(() => {})
    } catch (error) {
      this.handleError(error, flags.json)
    } finally {
      client.disconnect()
    }
  }

  private handleError(error: unknown, asJson: boolean): never {
    if (error instanceof ChannelClientError) {
      if (asJson) {
        this.log(JSON.stringify({code: error.code, error: error.message, success: false}))
      } else {
        this.logToStderr(`[${error.code}] ${error.message}`)
      }

      this.exit(1)
    }

    throw error
  }
}
