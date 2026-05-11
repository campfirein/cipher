import {Args, Command, Flags} from '@oclif/core'

import type {
  ChannelMentionRequest,
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
    'no-wait': Flags.boolean({
      default: false,
      description: 'Return immediately after dispatch instead of streaming until terminal',
    }),
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(ChannelMention)

    try {
      await withChannelClient(async (client) => {
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
