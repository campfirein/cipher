import {rm} from 'node:fs/promises'
import {join} from 'node:path'

import type {IContextTreeService} from '../../core/interfaces/i-context-tree-service.js'
import type {IContextTreeSnapshotService} from '../../core/interfaces/i-context-tree-snapshot-service.js'
import type {ITerminal} from '../../core/interfaces/i-terminal.js'
import type {IClearUseCase} from '../../core/interfaces/usecase/i-clear-use-case.js'

import {BRV_DIR, CONTEXT_TREE_DIR} from '../../constants.js'

export interface ClearUseCaseOptions {
  contextTreeService: IContextTreeService
  contextTreeSnapshotService: IContextTreeSnapshotService
  terminal: ITerminal
}

export class ClearUseCase implements IClearUseCase {
  private readonly contextTreeService: IContextTreeService
  private readonly contextTreeSnapshotService: IContextTreeSnapshotService
  private readonly terminal: ITerminal

  constructor(options: ClearUseCaseOptions) {
    this.contextTreeService = options.contextTreeService
    this.contextTreeSnapshotService = options.contextTreeSnapshotService
    this.terminal = options.terminal
  }

  // Protected method for testability - can be overridden in tests
  protected async confirmClear(): Promise<boolean> {
    return this.terminal.confirm({
      default: false,
      message:
        'Are you sure you want to reset the context tree? This will remove all existing context and restore default domains.',
    })
  }

  public async run(options: {directory?: string; skipConfirmation: boolean}): Promise<void> {
    try {
      // Check if context tree exists
      const exists = await this.contextTreeService.exists(options.directory)

      if (!exists) {
        this.terminal.log('No context tree found. Nothing to clear.')
        return
      }

      // Confirmation prompt (unless skipConfirmation is true)
      if (!options.skipConfirmation) {
        const confirmed = await this.confirmClear()

        if (!confirmed) {
          this.terminal.log('Cancelled. Context tree was not reset.')
          return
        }
      }

      // Remove existing context tree directory
      const baseDir = options.directory ?? process.cwd()
      const contextTreeDir = join(baseDir, BRV_DIR, CONTEXT_TREE_DIR)
      await rm(contextTreeDir, {force: true, recursive: true})

      // Re-initialize context tree with default domains
      await this.contextTreeService.initialize(options.directory)

      // Re-initialize empty snapshot
      await this.contextTreeSnapshotService.initEmptySnapshot(options.directory)

      this.terminal.log('✓ Context tree reset successfully.')
      this.terminal.log('  6 default domains restored: code_style, design, structure, compliance, testing, bug_fixes')
    } catch (error) {
      // Handle user cancelling the prompt (Ctrl+C or closing stdin)
      const errorMessage = error instanceof Error ? error.message : String(error)
      if (errorMessage.includes('User force closed') || errorMessage.includes('force closed')) {
        this.terminal.log('Cancelled. Context tree was not reset.')
        return
      }

      // For other errors, log error message
      this.terminal.error(error instanceof Error ? error.message : 'Failed to reset context tree')
    }
  }
}
