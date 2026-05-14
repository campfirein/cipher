import {Args, Command, Flags} from '@oclif/core'

import type {
  ChannelMentionRequest,
  ChannelMentionSyncResponse,
  ChannelTurnAcceptedResponse,
} from '../../../shared/transport/events/channel-events.js'
import type {TurnEvent} from '../../../shared/types/channel.js'

import {ChannelEvents} from '../../../shared/transport/events/channel-events.js'
import {ChannelClientError, withChannelClient} from '../../lib/channel-client.js'

export default class ChannelMention extends Command {
  public static args = {
    channelId: Args.string({description: 'Channel handle', required: true}),
    text: Args.string({description: 'Prompt text (may contain @mentions)', required: true}),
  }
public static description = 'Dispatch a mention to ACP agent members and stream the reply'
public static examples = [
    '<%= config.bin %> <%= command.id %> pi-test "@mock please review"',
    '<%= config.bin %> <%= command.id %> pi-test "@mock ping" --no-wait --json',
  ]
public static flags = {
    'idempotency-key': Flags.string({description: 'Optional dedupe key (CHANNEL_PROTOCOL.md §12)'}),
    json: Flags.boolean({default: false, description: 'Emit JSON instead of pretty output'}),
    // Slice 8.0 — sync mode + thought suppression. `--mode sync` makes
    // the daemon block the ack until the turn reaches a terminal state
    // and assemble `{finalAnswer, toolCalls, durationMs}` instead of
    // returning the immediate ChannelTurnAcceptedResponse. Default
    // 'stream' preserves Phase-1..7 behaviour. `--suppress-thoughts`
    // drops `agent_thought_chunk` events on both the wire and disk.
    mode: Flags.string({
      default: 'stream',
      description: 'Wire mode: "stream" (default, Phase 1–7 behaviour) or "sync" (block until terminal)',
      options: ['stream', 'sync'],
    }),
    'no-wait': Flags.boolean({
      default: false,
      description: 'Return immediately after dispatch instead of streaming until terminal',
    }),
    'suppress-thoughts': Flags.boolean({
      default: false,
      description: 'Drop agent_thought_chunk events at the daemon (no broadcast, no persist)',
    }),
    timeout: Flags.integer({
      description: 'Sync-mode timeout in ms (default 300_000; ignored unless --mode sync)',
    }),
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(ChannelMention)

    try {
      await withChannelClient(async (client) => {
        // Slice 8.0 — sync mode: the daemon buffers the turn and acks
        // with `{finalAnswer, toolCalls, ...}` when terminal. No client-side
        // stream subscription is needed.
        if (flags.mode === 'sync') {
          // Bug 1 follow-up: in sync mode the daemon holds the ack until the
          // turn settles, so the transport request-timeout MUST be ≥ the
          // daemon-side turn timeout. Otherwise the CLI sees
          // `CHANNEL_REQUEST_TIMEOUT` at the env default (60s) even when the
          // user passed `--timeout 300000`. Pass `(timeout + 5s grace)` so the
          // resolved ack has time to travel back.
          const turnTimeoutMs = flags.timeout ?? 300_000
          const transportTimeoutMs = turnTimeoutMs + 5000
          const syncResponse = await client.request<ChannelMentionRequest, ChannelMentionSyncResponse>(
            ChannelEvents.MENTION,
            {
              channelId: args.channelId,
              idempotencyKey: flags['idempotency-key'],
              mode: 'sync',
              prompt: args.text,
              suppressThoughts: flags['suppress-thoughts'],
              timeout: flags.timeout,
            },
            {timeoutMs: transportTimeoutMs},
          )
          if (flags.json) {
            this.log(JSON.stringify(syncResponse, undefined, 2))
          } else {
            this.log(syncResponse.finalAnswer)
            this.log(`turn ${syncResponse.turnId} ${syncResponse.endedState} (${syncResponse.durationMs}ms)`)
          }

          return
        }

        // Stream mode (default) — Phase 1–7 behaviour.
        // Subscribe BEFORE sending the request so the broadcast is not missed.
        if (!flags['no-wait']) await client.subscribe(args.channelId)

        let terminalResolve: ((value: 'cancelled' | 'completed') => void) | undefined
        const terminal = new Promise<'cancelled' | 'completed'>((resolve) => {
          terminalResolve = resolve
        })

        const off = flags['no-wait']
          ? undefined
          : client.on<{channelId: string; event: TurnEvent}>(ChannelEvents.TURN_EVENT, (data) => {
              if (data.channelId !== args.channelId) return
              this.renderEvent(data.event)
              if (
                data.event.kind === 'turn_state_change' &&
                (data.event.to === 'completed' || data.event.to === 'cancelled')
              ) {
                terminalResolve?.(data.event.to)
              }
            })

        const accepted = await client.request<ChannelMentionRequest, ChannelTurnAcceptedResponse>(
          ChannelEvents.MENTION,
          {
            channelId: args.channelId,
            idempotencyKey: flags['idempotency-key'],
            prompt: args.text,
            suppressThoughts: flags['suppress-thoughts'],
          },
        )

        if (flags['no-wait']) {
          if (flags.json) {
            this.log(JSON.stringify(accepted, undefined, 2))
          } else {
            this.log(`turn ${accepted.turn.turnId} dispatched (${accepted.deliveries.length} delivery)`)
          }

          return
        }

        const finalState = await terminal
        off?.()
        await client.unsubscribe(args.channelId)
        if (flags.json) {
          this.log(JSON.stringify({...accepted, state: finalState}, undefined, 2))
        } else {
          this.log(`turn ${accepted.turn.turnId} ${finalState}`)
        }
      })
    } catch (error) {
      this.handleError(error, flags.json)
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

  private renderEvent(event: TurnEvent): void {
    const tag = `[${event.memberHandle ?? '@you'}]`
    switch (event.kind) {
      case 'agent_message_chunk': {
        this.log(`${tag} ${event.content}`)
        break
      }

      case 'agent_thought_chunk': {
        if (process.stdout.isTTY) this.log(`${tag} (thinking) ${event.content}`)
        break
      }

      case 'permission_request': {
        this.log(`${tag} permission_request id=${event.permissionRequestId}`)
        break
      }

      case 'tool_call': {
        this.log(`${tag} tool_call ${event.name}`)
        break
      }

      default: {
        // delivery_state_change / turn_state_change / etc — surface terse trace.
        if (event.kind === 'delivery_state_change' || event.kind === 'turn_state_change') {
          this.log(`${tag} ${event.kind} ${event.from} → ${event.to}`)
        }
      }
    }
  }
}
