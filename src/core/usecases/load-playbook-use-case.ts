import {readdir, readFile} from 'node:fs/promises'
import {join} from 'node:path'

import type {Playbook} from '../domain/entities/playbook.js'
import type {IPlaybookStore} from '../interfaces/i-playbook-store.js'

import {ReflectorOutput} from '../domain/entities/reflector-output.js'

export interface LoadPlaybookResult {
  error?: string
  playbook?: Playbook
  playbookPrompt?: string
  recentReflections?: ReflectorOutput[]
  success: boolean
}

/**
 * Use case for loading playbook and recent reflections.
 * Returns playbook with formatted prompt string for executor consumption.
 */
export class LoadPlaybookUseCase {
  private static readonly ACE_DIR = 'ace'
  private static readonly BR_DIR = '.br'
  private static readonly REFLECTIONS_DIR = 'reflections'
private readonly playbookStore: IPlaybookStore

  public constructor(playbookStore: IPlaybookStore) {
    this.playbookStore = playbookStore
  }

  public async execute(
    directory?: string,
    options: {includeReflections?: boolean; reflectionCount?: number} = {},
  ): Promise<LoadPlaybookResult> {
    try {
      const {includeReflections = false, reflectionCount = 3} = options

      // Load playbook
      const playbook = await this.playbookStore.load(directory)
      if (!playbook) {
        return {
          error: 'Playbook not found. Run `br init` to initialize.',
          success: false,
        }
      }

      // Generate prompt string
      const playbookPrompt = playbook.asPrompt()

      // Load recent reflections if requested
      let recentReflections: ReflectorOutput[] | undefined
      if (includeReflections) {
        recentReflections = await this.loadRecentReflections(directory, reflectionCount)
      }

      return {
        playbook,
        playbookPrompt,
        recentReflections,
        success: true,
      }
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Failed to load playbook',
        success: false,
      }
    }
  }

  private async loadRecentReflections(
    directory: string | undefined,
    count: number,
  ): Promise<ReflectorOutput[]> {
    try {
      const baseDir = directory ?? process.cwd()
      const reflectionsDir = join(
        baseDir,
        LoadPlaybookUseCase.BR_DIR,
        LoadPlaybookUseCase.ACE_DIR,
        LoadPlaybookUseCase.REFLECTIONS_DIR,
      )

      // Read all reflection files
      const files = await readdir(reflectionsDir)
      const reflectionFiles = files
        .filter((f) => f.endsWith('.json'))
        .sort()
        .reverse() // Most recent first
        .slice(0, count)

      // Load and parse reflections
      const reflections = await Promise.all(
        reflectionFiles.map(async (file) => {
          const filePath = join(reflectionsDir, file)
          const content = await readFile(filePath, 'utf8')
          const json = JSON.parse(content)
          return ReflectorOutput.fromJson(json)
        }),
      )

      return reflections
    } catch {
      // If reflections directory doesn't exist or is empty, return empty array
      return []
    }
  }
}
