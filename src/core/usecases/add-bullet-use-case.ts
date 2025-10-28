import type {Bullet, BulletMetadata} from '../domain/entities/bullet.js'
import type {Playbook} from '../domain/entities/playbook.js'
import type {IPlaybookStore} from '../interfaces/i-playbook-store.js'

export interface AddBulletInput {
  bulletId?: string
  content: string
  metadata?: BulletMetadata
  section: string
}

export interface AddBulletResult {
  bullet?: Bullet
  error?: string
  operation?: 'ADD' | 'UPDATE'
  playbook?: Playbook
  success: boolean
}

/**
 * Use case for adding or updating a single bullet in the playbook.
 * This bypasses the ACE workflow (executor → reflector → curator → apply-delta)
 * and provides direct playbook manipulation for agents.
 */
export class AddBulletUseCase {
  private readonly playbookStore: IPlaybookStore

  public constructor(playbookStore: IPlaybookStore) {
    this.playbookStore = playbookStore
  }

  /**
   * Adds a new bullet or updates an existing one.
   *
   * @param input The bullet details (section, content, optional bulletId)
   * @param directory The project directory (defaults to current working directory)
   * @returns Result with the bullet and operation type, or error message
   */
  public async execute(input: AddBulletInput, directory?: string): Promise<AddBulletResult> {
    try {
      // Validate input
      if (!input.section || input.section.trim().length === 0) {
        return {
          error: 'Section is required',
          success: false,
        }
      }

      if (!input.content || input.content.trim().length === 0) {
        return {
          error: 'Content is required',
          success: false,
        }
      }

      // Load existing playbook or create new one
      let playbook = await this.playbookStore.load(directory)
      if (!playbook) {
        // Import Playbook here to avoid circular dependency
        const {Playbook} = await import('../domain/entities/playbook.js')
        playbook = new Playbook()
      }

      let bullet: Bullet
      let operation: 'ADD' | 'UPDATE'

      // Determine operation type based on bulletId presence
      if (input.bulletId) {
        // UPDATE operation
        const existingBullet = playbook.getBullet(input.bulletId)
        if (!existingBullet) {
          return {
            error: `Bullet with ID '${input.bulletId}' not found`,
            success: false,
          }
        }

        const updatedBullet = playbook.updateBullet(input.bulletId, {
          content: input.content,
          metadata: input.metadata,
        })

        if (!updatedBullet) {
          return {
            error: `Failed to update bullet '${input.bulletId}'`,
            success: false,
          }
        }

        bullet = updatedBullet
        operation = 'UPDATE'
      } else {
        // ADD operation
        // Ensure metadata has at least one tag (required by Bullet entity)
        const metadata = input.metadata ?? {
          relatedFiles: [],
          tags: ['manual'],
          timestamp: new Date().toISOString(),
        }

        // If metadata is provided but tags are empty, add default tag
        if (metadata.tags.length === 0) {
          metadata.tags = ['manual']
        }

        bullet = playbook.addBullet(input.section, input.content, undefined, metadata)
        operation = 'ADD'
      }

      // Save updated playbook
      await this.playbookStore.save(playbook, directory)

      return {
        bullet,
        operation,
        playbook,
        success: true,
      }
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Failed to add/update bullet',
        success: false,
      }
    }
  }
}
