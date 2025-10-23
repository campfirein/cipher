import type {Playbook} from '../domain/entities/playbook.js'
import type {ReflectorOutput} from '../domain/entities/reflector-output.js'
import type {IPlaybookStore} from '../interfaces/i-playbook-store.js'

export interface ApplyReflectionTagsResult {
  error?: string
  playbook?: Playbook
  success: boolean
  tagsApplied?: number
}

/**
 * Use case for applying bullet tags from reflection to playbook.
 * Updates bullet metadata with tags and saves playbook.
 */
export class ApplyReflectionTagsUseCase {
  private readonly playbookStore: IPlaybookStore

  public constructor(playbookStore: IPlaybookStore) {
    this.playbookStore = playbookStore
  }

  public async execute(
    reflection: ReflectorOutput,
    directory?: string,
  ): Promise<ApplyReflectionTagsResult> {
    try {
      // Load playbook
      const playbook = await this.playbookStore.load(directory)
      if (!playbook) {
        return {
          error: 'Playbook not found. Run `br ace init` to initialize.',
          success: false,
        }
      }

      // Apply tags from reflection
      let tagsApplied = 0
      for (const bulletTag of reflection.bulletTags) {
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
        success: true,
        tagsApplied,
      }
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Failed to apply reflection tags',
        success: false,
      }
    }
  }
}
