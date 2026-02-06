import type {ProjectInfo} from '../../domain/project/project-info.js'

/**
 * Registry for mapping project paths to their XDG storage locations.
 *
 * Manages the lifecycle of project registrations: creating per-project
 * directories, persisting the mapping to disk, and providing lookups.
 *
 * Consumed by transport-handlers (T3/T4) during client registration.
 */
export interface IProjectRegistry {
  /**
   * Get a registered project by its path.
   * The path is resolved to its canonical form before lookup.
   *
   * @param projectPath - Absolute path to the project
   * @returns ProjectInfo if registered, undefined otherwise
   */
  get(projectPath: string): ProjectInfo | undefined

  /**
   * Get all registered projects.
   *
   * @returns Read-only map of resolved projectPath → ProjectInfo
   */
  getAll(): ReadonlyMap<string, ProjectInfo>

  /**
   * Register a project. Idempotent — returns existing ProjectInfo
   * if the project is already registered.
   *
   * On first registration:
   * - Resolves symlinks in the project path
   * - Creates per-project XDG directories (sessions/, etc.)
   * - Persists the mapping to registry.json
   *
   * @param projectPath - Absolute path to the project root
   * @returns ProjectInfo with the storage path mapping
   */
  register(projectPath: string): ProjectInfo

  /**
   * Remove a project from the registry.
   * Does NOT delete the project's XDG directories (data preservation).
   *
   * @param projectPath - Absolute path to the project
   * @returns true if the project was registered and removed, false if not found
   */
  unregister(projectPath: string): boolean
}
