import {Args, Command, Flags} from '@oclif/core'

import {
  type IVcCheckoutRequest,
  type IVcCheckoutResponse,
  VcEvents,
} from '../../../shared/transport/events/vc-events.js'
import {formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'

export default class VcCheckout extends Command {
  public static args = {
    branch: Args.string({description: 'Branch to switch to', required: true}),
  }
  public static description = 'Switch to an existing branch, or create and switch with -b'
  public static examples = [
    '<%= config.bin %> <%= command.id %> feature/my-branch',
    '<%= config.bin %> <%= command.id %> -b feature/new-branch',
    '<%= config.bin %> <%= command.id %> --force feature/my-branch',
  ]
  public static flags = {
    create: Flags.boolean({
      char: 'b',
      default: false,
      description: 'Create a new branch and switch to it',
    }),
    force: Flags.boolean({
      default: false,
      description: 'Discard local changes and switch',
    }),
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(VcCheckout)

    try {
      const result = await this.requestCheckout({
        branch: args.branch,
        create: flags.create,
        force: flags.force,
      })

      if (result.created) {
        this.log(`Created and switched to branch '${result.branch}'.`)
      } else {
        this.log(`Switched to branch '${result.branch}'.`)
      }
    } catch (error) {
      this.error(formatConnectionError(error))
    }
  }

  private requestCheckout(req: IVcCheckoutRequest): Promise<IVcCheckoutResponse> {
    return withDaemonRetry<IVcCheckoutResponse>((client) =>
      client.requestWithAck<IVcCheckoutResponse>(VcEvents.CHECKOUT, req),
    )
  }
}
