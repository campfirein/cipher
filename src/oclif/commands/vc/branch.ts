import {Args, Command, Flags} from '@oclif/core'

import {type IVcBranchRequest, type IVcBranchResponse, VcEvents} from '../../../shared/transport/events/vc-events.js'
import {formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'

export default class VcBranch extends Command {
  public static args = {
    name: Args.string({description: 'Branch name to create'}),
  }
  public static description = 'List, create, or delete local branches'
  public static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> feature/new-context',
    '<%= config.bin %> <%= command.id %> -d feature/new-context',
    '<%= config.bin %> <%= command.id %> -a',
    '<%= config.bin %> <%= command.id %> --set-upstream-to origin/main',
  ]
  public static flags = {
    all: Flags.boolean({
      char: 'a',
      default: false,
      description: 'List all branches including remote-tracking',
    }),
    delete: Flags.string({
      char: 'd',
      description: 'Delete a branch by name',
    }),
    'set-upstream-to': Flags.string({
      description: 'Set upstream tracking (e.g. origin/main)',
    }),
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(VcBranch)

    try {
      if (flags['set-upstream-to']) {
        const result = await this.requestBranch({action: 'set-upstream', upstream: flags['set-upstream-to']})
        if (result.action === 'set-upstream') {
          this.log(`Branch '${result.branch}' set up to track '${result.upstream}'.`)
        }

        return
      }

      if (flags.delete) {
        const result = await this.requestBranch({action: 'delete', name: flags.delete})
        if (result.action === 'delete') this.log(`Deleted branch '${result.deleted}'.`)
        return
      }

      if (args.name) {
        const result = await this.requestBranch({action: 'create', name: args.name})
        if (result.action === 'create') this.log(`Created branch '${result.created}'.`)
        return
      }

      const result = await this.requestBranch({action: 'list', all: flags.all})

      if (result.action !== 'list' || result.branches.length === 0) {
        this.log('No branches found.')
        return
      }

      for (const b of result.branches) {
        const prefix = b.isCurrent ? '* ' : '  '
        const name = b.isRemote ? `remotes/${b.name}` : b.name
        this.log(`${prefix}${name}`)
      }
    } catch (error) {
      this.error(formatConnectionError(error))
    }
  }

  private requestBranch(req: IVcBranchRequest): Promise<IVcBranchResponse> {
    return withDaemonRetry<IVcBranchResponse>((client) =>
      client.requestWithAck<IVcBranchResponse>(VcEvents.BRANCH, req),
    )
  }
}
