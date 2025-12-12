import {Args, Command, Flags} from '@oclif/core'
import {rm} from 'node:fs/promises'
import {join} from 'node:path'

import type {IContextTreeService} from '../core/interfaces/i-context-tree-service.js'
import type {IContextTreeSnapshotService} from '../core/interfaces/i-context-tree-snapshot-service.js'
import type {ITerminal} from '../core/interfaces/i-terminal.js'

import {BRV_DIR, CONTEXT_TREE_DIR} from '../constants.js'
import {FileContextTreeService} from '../infra/context-tree/file-context-tree-service.js'
import {FileContextTreeSnapshotService} from '../infra/context-tree/file-context-tree-snapshot-service.js'
import {OclifTerminal} from '../infra/terminal/oclif-terminal.js'

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
  protected terminal: ITerminal = {} as ITerminal

  // Protected method for testability - can be overridden in tests
  protected async confirmClear(): Promise<boolean> {
    return this.terminal.confirm({
      default: false,
      message:
        'Are you sure you want to reset the context tree? This will remove all existing context and restore default domains.',
    })
  }

  protected createServices(): {
    contextTreeService: IContextTreeService
    contextTreeSnapshotService: IContextTreeSnapshotService
  } {
    this.terminal = new OclifTerminal(this)
    return {
      contextTreeService: new FileContextTreeService(),
      contextTreeSnapshotService: new FileContextTreeSnapshotService(),
    }
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(Clear)

    try {
      const {contextTreeService, contextTreeSnapshotService} = this.createServices()

      // Check if context tree exists
      const exists = await contextTreeService.exists(args.directory)

      if (!exists) {
        this.terminal.log('No context tree found. Nothing to clear.')
        return
      }

      // Confirmation prompt (unless --yes flag is used)
      if (!flags.yes) {
        const confirmed = await this.confirmClear()

        if (!confirmed) {
          this.terminal.log('Cancelled. Context tree was not reset.')
          return
        }
      }

      // Remove existing context tree directory
      const baseDir = args.directory ?? process.cwd()
      const contextTreeDir = join(baseDir, BRV_DIR, CONTEXT_TREE_DIR)
      await rm(contextTreeDir, {force: true, recursive: true})

      // Re-initialize context tree with default domains
      await contextTreeService.initialize(args.directory)

      // Re-initialize empty snapshot
      await contextTreeSnapshotService.initEmptySnapshot(args.directory)

      this.terminal.log('✓ Context tree reset successfully.')
      this.terminal.log('  6 default domains restored: code_style, design, structure, compliance, testing, bug_fixes')
    } catch (error) {
      // Handle user cancelling the prompt (Ctrl+C or closing stdin)
      const errorMessage = error instanceof Error ? error.message : String(error)
      if (errorMessage.includes('User force closed') || errorMessage.includes('force closed')) {
        this.terminal.log('Cancelled. Context tree was not reset.')
        return
      }

      // For other errors, throw to let oclif handle display
      this.terminal.error(error instanceof Error ? error.message : 'Failed to reset context tree')
    }
  }
}
