import type {SessionInfo} from '../../../../agent/core/domain/session/session-metadata.js'
import type {BrvConfig} from '../../domain/entities/brv-config.js'

/**
 * Loaded state for a single project.
 * Contains config (from .brv/config.json) and sessions (from XDG sessions dir).
 */
export type ProjectState = {
  /** BrvConfig from <projectPath>/.brv/config.json, or undefined if not found/invalid */
  readonly config: BrvConfig | undefined
  /** Timestamp when this state was loaded from disk */
  readonly loadedAt: number
  /** Session list from XDG sessions dir, empty array if none */
  readonly sessions: readonly SessionInfo[]
}

/**
 * Error context for a failed project state load.
 */
export type ProjectStateError = {
  /** The error that occurred */
  readonly error: Error
  /** The project path that failed */
  readonly projectPath: string
}

/**
 * Result type for project state loading.
 * Uses discriminated union (ok field) instead of thrown errors
 * to prevent server crash on individual project load failures.
 */
export type ProjectStateResult =
  | {error: ProjectStateError; ok: false}
  | {ok: true; state: ProjectState}

/**
 * Lazy-loading per-project state provider with promise deduplication.
 *
 * When multiple concurrent requests arrive for the same project,
 * only one disk read occurs. All callers receive the same result.
 *
 * Promise dedup flow:
 *   10 concurrent requests for project-a state:
 *   -> Request 1: starts loading, stores Promise in cache
 *   -> Requests 2-10: find Promise in cache, await same Promise
 *   -> All 10 get same result, only 1 disk read
 *
 * Consumed by brv-server.ts to provide project state to clients
 * and agent child processes on demand.
 */
export interface IProjectStateLoader {
  /**
   * Get cached project config synchronously.
   * Returns undefined if not yet loaded — does NOT trigger a disk read.
   * Used by lazy providers (spaceIdProvider, teamIdProvider) that need
   * synchronous access to already-loaded config values per HTTP request.
   *
   * @param projectPath - Absolute path to the project root
   * @returns The cached config or undefined if not loaded yet
   */
  getCachedProjectConfig(projectPath: string): BrvConfig | undefined

  /**
   * Get project config from <projectPath>/.brv/config.json.
   * Uses cached state if available, otherwise loads from disk.
   * Concurrent calls for the same project share one load.
   *
   * @param projectPath - Absolute path to the project root
   * @returns The config or undefined if not found/invalid
   */
  getProjectConfig(projectPath: string): Promise<BrvConfig | undefined>

  /**
   * Get project sessions from XDG sessions directory.
   * Uses cached state if available, otherwise loads from disk.
   * Concurrent calls for the same project share one load.
   *
   * @param projectPath - Absolute path to the project root
   * @returns Array of session info, empty if none
   */
  getProjectSessions(projectPath: string): Promise<readonly SessionInfo[]>

  /**
   * Get the full project state (config + sessions).
   * Uses cached state if available, otherwise loads from disk.
   * Concurrent calls for the same project share one load.
   *
   * @param projectPath - Absolute path to the project root
   * @returns Result object: ok:true with state, or ok:false with error
   */
  getProjectState(projectPath: string): Promise<ProjectStateResult>

  /**
   * Invalidate cached state for a project.
   * Next call to getProject* will reload from disk.
   * Use after config:updated or session:created events.
   *
   * @param projectPath - Absolute path to the project root
   */
  invalidate(projectPath: string): void

  /**
   * Invalidate all cached project states.
   * Use during shutdown or major state reset.
   */
  invalidateAll(): void

  /**
   * Check if the cached config for a project needs invalidation.
   * Compares file modification time with cache timestamp.
   *
   * @param projectPath - Absolute path to the project root
   * @returns True if cache should be invalidated (file was modified), false otherwise
   */
  shouldInvalidate(projectPath: string): Promise<boolean>
}
