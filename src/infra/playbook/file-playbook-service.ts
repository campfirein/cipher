import {mkdir} from 'node:fs/promises'
import {join} from 'node:path'

import type {Bullet, BulletMetadata} from '../../core/domain/entities/bullet.js'
import type {DeltaBatch} from '../../core/domain/entities/delta-batch.js'
import type {ReflectorOutput} from '../../core/domain/entities/reflector-output.js'
import type {IPlaybookService} from '../../core/interfaces/i-playbook-service.js'
import type {IPlaybookStore} from '../../core/interfaces/i-playbook-store.js'

import {ACE_DIR, BR_DIR, DELTAS_DIR, EXECUTOR_OUTPUTS_DIR, REFLECTIONS_DIR} from '../../constants.js'
import {Playbook} from '../../core/domain/entities/playbook.js'
import {FilePlaybookStore} from '../ace/file-playbook-store.js'

export type PlaybookServiceConfig = {
  baseDirectory?: string
}

/**
 * File-based implementation of IPlaybookService.
 * Provides high-level playbook operations including initialization,
 * bullet management, delta application, and reflection tag processing.
 */
export class FilePlaybookService implements IPlaybookService {
  private static readonly SUBDIRS = [REFLECTIONS_DIR, EXECUTOR_OUTPUTS_DIR, DELTAS_DIR]
  private readonly config: PlaybookServiceConfig
  private readonly playbookStore: IPlaybookStore

  public constructor(config: PlaybookServiceConfig = {}, playbookStore: IPlaybookStore = new FilePlaybookStore()) {
    this.config = config
    this.playbookStore = playbookStore
  }

  public async addOrUpdateBullet(params: {
    bulletId?: string
    content: string
    directory?: string
    metadata?: BulletMetadata
    section: string
  }): Promise<Bullet> {
    // Validate input
    if (!params.section || params.section.trim().length === 0) {
      throw new Error('Section is required')
    }

    if (!params.content || params.content.trim().length === 0) {
      throw new Error('Content is required')
    }

    const directory = params.directory ?? this.config.baseDirectory

    // Load existing playbook or create new one
    let playbook = await this.playbookStore.load(directory)
    if (!playbook) {
      playbook = new Playbook()
    }

    let bullet: Bullet

    // Determine operation type based on bulletId presence
    if (params.bulletId) {
      // UPDATE operation
      const existingBullet = playbook.getBullet(params.bulletId)
      if (!existingBullet) {
        throw new Error(`Bullet with ID '${params.bulletId}' not found`)
      }

      const updatedBullet = playbook.updateBullet(params.bulletId, {
        content: params.content,
        metadata: params.metadata,
      })

      if (!updatedBullet) {
        throw new Error(`Failed to update bullet '${params.bulletId}'`)
      }

      bullet = updatedBullet
    } else {
      // ADD operation
      // Ensure metadata has at least one tag (required by Bullet entity)
      const metadata = params.metadata ?? {
        relatedFiles: [],
        tags: ['manual'],
        timestamp: new Date().toISOString(),
      }

      // If metadata is provided but tags are empty, add default tag
      if (metadata.tags.length === 0) {
        metadata.tags = ['manual']
      }

      bullet = playbook.addBullet(params.section, params.content, undefined, metadata)
    }

    // Save updated playbook
    await this.playbookStore.save(playbook, directory)

    return bullet
  }

  public async applyDelta(params: {
    delta: DeltaBatch
    directory?: string
  }): Promise<{operationsApplied: number; playbook: Playbook}> {
    const directory = params.directory ?? this.config.baseDirectory

    // Load existing playbook or create new one
    let playbook = await this.playbookStore.load(directory)
    if (!playbook) {
      playbook = new Playbook()
    }

    // Apply delta operations
    playbook.applyDelta(params.delta)

    // Save updated playbook
    await this.playbookStore.save(playbook, directory)

    return {
      operationsApplied: params.delta.getOperationCount(),
      playbook,
    }
  }

  public async applyReflectionTags(params: {
    directory?: string
    reflection: ReflectorOutput
  }): Promise<{playbook: Playbook; tagsApplied: number}> {
    const directory = params.directory ?? this.config.baseDirectory

    // Load playbook
    const playbook = await this.playbookStore.load(directory)
    if (!playbook) {
      throw new Error('Playbook not found. Run `br init` to initialize.')
    }

    // Apply tags from reflection
    let tagsApplied = 0
    for (const bulletTag of params.reflection.bulletTags) {
      const {id, tag} = bulletTag

      // Check if bullet exists
      const bullet = playbook.getBullet(id)
      if (!bullet) {
        // Skip non-existent bullets (might have been removed)
        continue
      }

      // Add tag to bullet (appends to tags array if not already present)
      const updated = playbook.addTagToBullet(id, tag)
      if (updated) {
        tagsApplied++
      }
    }

    // Save updated playbook
    await this.playbookStore.save(playbook, directory)

    return {
      playbook,
      tagsApplied,
    }
  }

  public async initialize(directory?: string): Promise<string> {
    const baseDir = directory ?? this.config.baseDirectory ?? process.cwd()
    const brDir = join(baseDir, BR_DIR)
    const aceDir = join(brDir, ACE_DIR)

    // Create .br/ace/ directory
    await mkdir(aceDir, {recursive: true})

    // Create subdirectories
    await Promise.all(
      FilePlaybookService.SUBDIRS.map((subdir) => mkdir(join(aceDir, subdir), {recursive: true})),
    )

    // Check if playbook already exists
    const exists = await this.playbookStore.exists(directory ?? this.config.baseDirectory)
    if (exists) {
      throw new Error('Playbook already exists. Use `br clear` to remove it first.')
    }

    // Create empty playbook
    const playbook = new Playbook()
    await this.playbookStore.save(playbook, directory ?? this.config.baseDirectory)

    return join(aceDir, 'playbook.json')
  }
}
