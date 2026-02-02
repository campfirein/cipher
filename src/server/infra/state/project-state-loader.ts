import type {SessionInfo} from '../../../agent/core/domain/session/session-metadata.js'
import type {BrvConfig} from '../../core/domain/entities/brv-config.js'
import type {IProjectRegistry} from '../../core/interfaces/project/i-project-registry.js'
import type {
  IProjectStateLoader,
  ProjectState,
  ProjectStateResult,
} from '../../core/interfaces/state/i-project-state-loader.js'
import type {IProjectConfigStore} from '../../core/interfaces/storage/i-project-config-store.js'

import {SessionMetadataStore} from '../../../agent/infra/session/session-metadata-store.js'

type ProjectStateLoaderOptions = {
  /** Project config reader (<projectPath>/.brv/config.json) */
  configStore: IProjectConfigStore
  /** Logging function (optional, defaults to no-op) */
  log?: (message: string) => void
  /** Project registry for resolving XDG storage paths */
  projectRegistry: IProjectRegistry
}

/**
 * Lazy-loading per-project state with promise deduplication.
 *
 * Two-level cache:
 * - loadedStates: cached results from completed loads
 * - loadPromises: in-flight promises for dedup
 *
 * Promise dedup flow:
 *   10 concurrent requests for /app state:
 *   -> Request 1: starts loading, stores Promise in loadPromises
 *   -> Requests 2-10: find Promise in loadPromises, await same Promise
 *   -> All 10 get same result, only 1 disk read
 *   -> Result moves to loadedStates, loadPromises entry cleared
 *
 * Error isolation: individual failures don't crash the server.
 * Config read error -> config:undefined (partial success).
 * Session read error -> sessions:[] (partial success).
 */
export class ProjectStateLoader implements IProjectStateLoader {
  private readonly configStore: IProjectConfigStore
  /** Cached loaded states: projectPath -> result */
  private readonly loadedStates: Map<string, ProjectStateResult> = new Map()
  /** In-flight load promises for dedup: projectPath -> Promise */
  private readonly loadPromises: Map<string, Promise<ProjectStateResult>> = new Map()
  private readonly log: (message: string) => void
  private readonly projectRegistry: IProjectRegistry

  constructor(options: ProjectStateLoaderOptions) {
    this.configStore = options.configStore
    this.projectRegistry = options.projectRegistry
    this.log = options.log ?? (() => {})
  }

  async getProjectConfig(projectPath: string): Promise<BrvConfig | undefined> {
    const result = await this.getProjectState(projectPath)
    return result.ok ? result.state.config : undefined
  }

  async getProjectSessions(projectPath: string): Promise<readonly SessionInfo[]> {
    const result = await this.getProjectState(projectPath)
    return result.ok ? result.state.sessions : []
  }

  async getProjectState(projectPath: string): Promise<ProjectStateResult> {
    // 1. Return cached result if available
    const cached = this.loadedStates.get(projectPath)
    if (cached) return cached

    // 2. Return in-flight promise if loading (dedup)
    const inflight = this.loadPromises.get(projectPath)
    if (inflight) return inflight

    // 3. Start new load and cache the promise
    const loadPromise = this.loadProjectState(projectPath)
    this.loadPromises.set(projectPath, loadPromise)

    try {
      const result = await loadPromise
      // Cache the result for future callers
      this.loadedStates.set(projectPath, result)
      return result
    } finally {
      // Always clear the in-flight promise (even on error)
      this.loadPromises.delete(projectPath)
    }
  }

  invalidate(projectPath: string): void {
    this.loadedStates.delete(projectPath)
    this.loadPromises.delete(projectPath)
    this.log(`Invalidated project state cache: ${projectPath}`)
  }

  invalidateAll(): void {
    this.loadedStates.clear()
    this.loadPromises.clear()
    this.log('Invalidated all project state caches')
  }

  /**
   * Load BrvConfig from <projectPath>/.brv/config.json.
   * Returns undefined if file missing or invalid (does NOT throw).
   */
  private async loadConfig(projectPath: string): Promise<BrvConfig | undefined> {
    try {
      return await this.configStore.read(projectPath)
    } catch (error) {
      this.log(`Config load error for ${projectPath}: ${error instanceof Error ? error.message : String(error)}`)
      return undefined
    }
  }

  /**
   * Load both config and sessions from disk for a single project.
   * Errors are caught and returned as ProjectStateResult with ok:false.
   */
  private async loadProjectState(projectPath: string): Promise<ProjectStateResult> {
    try {
      const [config, sessions] = await Promise.all([
        this.loadConfig(projectPath),
        this.loadSessions(projectPath),
      ])

      const state: ProjectState = {
        config,
        loadedAt: Date.now(),
        sessions,
      }

      this.log(`Loaded project state: ${projectPath} (config=${config ? 'yes' : 'no'}, sessions=${sessions.length})`)
      return {ok: true, state}
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      this.log(`Failed to load project state: ${projectPath}: ${err.message}`)
      return {
        error: {error: err, projectPath},
        ok: false,
      }
    }
  }

  /**
   * Load sessions from the project's XDG sessions directory.
   * Returns empty array if no sessions found or on error.
   */
  private async loadSessions(projectPath: string): Promise<SessionInfo[]> {
    try {
      const projectInfo = this.projectRegistry.get(projectPath)
      if (!projectInfo) {
        this.log(`Project not registered: ${projectPath} — cannot load sessions`)
        return []
      }

      const sessionsDir = `${projectInfo.storagePath}/sessions`
      const store = new SessionMetadataStore({sessionsDir, workingDirectory: projectPath})
      return await store.listSessions()
    } catch (error) {
      this.log(`Sessions load error for ${projectPath}: ${error instanceof Error ? error.message : String(error)}`)
      return []
    }
  }
}
