import type {Bullet, BulletMetadata} from '../domain/entities/bullet.js'
import type {DeltaBatch} from '../domain/entities/delta-batch.js'
import type {Playbook} from '../domain/entities/playbook.js'
import type {ReflectorOutput} from '../domain/entities/reflector-output.js'

/**
 * Interface for playbook operations service.
 * Provides high-level operations for managing ACE playbooks including
 * initialization, bullet management, delta application, and reflection tag processing.
 */
export interface IPlaybookService {
  /**
   * Adds a new bullet or updates an existing bullet in the playbook.
   * @param params - Bullet parameters
   * @param params.section - Section name for the bullet
   * @param params.content - Content of the bullet
   * @param params.bulletId - Optional bullet ID for update operation
   * @param params.metadata - Optional metadata (tags, related files, timestamp)
   * @param params.directory - Optional base directory (defaults to current working directory)
   * @returns The created or updated bullet
   * @throws Error if validation fails or bulletId not found for updates
   */
  addOrUpdateBullet(params: {
    bulletId?: string
    content: string
    directory?: string
    metadata?: BulletMetadata
    section: string
  }): Promise<Bullet>

  /**
   * Applies delta operations (ADD/UPDATE/REMOVE) to the playbook.
   * Creates a new playbook if it doesn't exist.
   * @param params - Delta application parameters
   * @param params.delta - Delta batch containing operations to apply
   * @param params.directory - Optional base directory (defaults to current working directory)
   * @returns Result containing operations applied count and updated playbook
   * @throws Error if delta application fails
   */
  applyDelta(params: {delta: DeltaBatch; directory?: string}): Promise<{
    operationsApplied: number
    playbook: Playbook
  }>

  /**
   * Applies reflection bullet tags to existing bullets in the playbook.
   * Skips bullets that don't exist in the playbook.
   * @param params - Reflection tag parameters
   * @param params.reflection - Reflection output containing bullet tags
   * @param params.directory - Optional base directory (defaults to current working directory)
   * @returns Result containing tags applied count and updated playbook
   * @throws Error if playbook not found or tag application fails
   */
  applyReflectionTags(params: {directory?: string; reflection: ReflectorOutput}): Promise<{
    playbook: Playbook
    tagsApplied: number
  }>

  /**
   * Initializes the ACE playbook directory structure and creates an empty playbook.
   * Creates .brv/ace/ directory with subdirectories: reflections/, executor-outputs/, deltas/
   * @param directory - Optional base directory (defaults to current working directory)
   * @returns The absolute path to the created playbook file
   * @throws Error if playbook already exists or initialization fails
   */
  initialize(directory?: string): Promise<string>
}
