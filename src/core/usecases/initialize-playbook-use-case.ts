import {mkdir} from 'node:fs/promises'
import {join} from 'node:path'

import type {IPlaybookStore} from '../interfaces/i-playbook-store.js'

import {Playbook} from '../domain/entities/playbook.js'

export interface InitializePlaybookResult {
  error?: string
  playbookPath?: string
  success: boolean
}

/**
 * Use case for initializing the ACE playbook directory structure.
 * Creates .br/ace/ directory with subdirectories and empty playbook.
 */
export class InitializePlaybookUseCase {
  private static readonly ACE_DIR = 'ace'
  private static readonly BR_DIR = '.br'
  private static readonly SUBDIRS = ['reflections']
  private readonly playbookStore: IPlaybookStore

  public constructor(playbookStore: IPlaybookStore) {
    this.playbookStore = playbookStore
  }

  public async execute(directory?: string): Promise<InitializePlaybookResult> {
    try {
      const baseDir = directory ?? process.cwd()
      const brDir = join(baseDir, InitializePlaybookUseCase.BR_DIR)
      const aceDir = join(brDir, InitializePlaybookUseCase.ACE_DIR)

      // Create .br/ace/ directory
      await mkdir(aceDir, {recursive: true})

      // Create subdirectories
      await Promise.all(
        InitializePlaybookUseCase.SUBDIRS.map((subdir) =>
          mkdir(join(aceDir, subdir), {recursive: true}),
        ),
      )

      // Check if playbook already exists
      const exists = await this.playbookStore.exists(directory)
      if (exists) {
        return {
          error: 'Playbook already exists. Use `br ace clear` to remove it first.',
          success: false,
        }
      }

      // Create empty playbook
      const playbook = new Playbook()
      await this.playbookStore.save(playbook, directory)

      return {
        playbookPath: join(aceDir, 'playbook.json'),
        success: true,
      }
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Failed to initialize playbook',
        success: false,
      }
    }
  }
}
