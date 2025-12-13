import {Args, Command, Flags} from '@oclif/core'

import type {IResetUseCase} from '../core/interfaces/usecase/i-reset-use-case.js'

import {FileContextTreeService} from '../infra/context-tree/file-context-tree-service.js'
import {FileContextTreeSnapshotService} from '../infra/context-tree/file-context-tree-snapshot-service.js'
import {OclifTerminal} from '../infra/terminal/oclif-terminal.js'
import {ResetUseCase} from '../infra/usecase/reset-use-case.js'

export default class Clear extends Command {
  public static args = {
    directory: Args.string({description: 'Project directory (defaults to current directory)', required: false}),
  }
  public static description = 'Reset the context tree to its original state (6 default domains)'
  public static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --yes',
    '<%= config.bin %> <%= command.id %> /path/to/project',
  ]
  public static flags = {
    yes: Flags.boolean({
      char: 'y',
      default: false,
      description: 'Skip confirmation prompt',
    }),
  }

  protected createServices(): IResetUseCase {
    const terminal = new OclifTerminal(this)

    return new ResetUseCase({
      contextTreeService: new FileContextTreeService(),
      contextTreeSnapshotService: new FileContextTreeSnapshotService(),
      terminal,
    })
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(Clear)

    const resetUseCase = this.createServices()

    await resetUseCase.run({
      directory: args.directory,
      skipConfirmation: flags.yes,
    })
  }
}
