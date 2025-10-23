import type {DeltaBatch} from '../domain/entities/delta-batch.js'
import type {IPlaybookStore} from '../interfaces/i-playbook-store.js'

import {Playbook} from '../domain/entities/playbook.js'

export interface ApplyDeltaResult {
  error?: string
  operationsApplied?: number
  playbook?: Playbook
  success: boolean
}

/**
 * Use case for applying delta operations to a playbook.
 * Loads the playbook, applies changes, and saves it back to storage.
 */
export class ApplyDeltaUseCase {
  private readonly playbookStore: IPlaybookStore

  public constructor(playbookStore: IPlaybookStore) {
    this.playbookStore = playbookStore
  }

  /**
   * Applies a delta batch to the playbook.
   * Creates a new playbook if one doesn't exist.
   *
   * @param delta The delta batch containing operations to apply
   * @param directory The project directory (defaults to current working directory)
   * @returns Result with updated playbook or error message
   */
  public async execute(delta: DeltaBatch, directory?: string): Promise<ApplyDeltaResult> {
    try {
      // Load existing playbook or create new one
      const playbook = await this.playbookStore.load(directory)
      if (!playbook) {
        return {
          error: 'Playbook not found. Run `br ace init` to initialize.',
          success: false,
        }
      }

      // Apply delta operations
      playbook.applyDelta(delta)

      // Save updated playbook
      await this.playbookStore.save(playbook, directory)

      return {
        operationsApplied: delta.getOperationCount(),
        playbook,
        success: true,
      }
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Failed to apply delta',
        success: false,
      }
    }
  }
}
