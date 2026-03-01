import {mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {z} from 'zod'

import type {IProjectRegistry} from '../../core/interfaces/project/i-project-registry.js'

import {GLOBAL_PROJECTS_DIR, REGISTRY_FILE} from '../../constants.js'
import {isValidProjectInfoJson, ProjectInfo} from '../../core/domain/project/project-info.js'
import {getGlobalDataDir} from '../../utils/global-data-path.js'
import {resolvePath, sanitizeProjectPath} from '../../utils/path-utils.js'

/**
 * Zod schema for validating registry.json on disk.
 */
const RegistryFileSchema = z.object({
  projects: z.record(z.string(), z.unknown()),
  version: z.number(),
})

type RegistryFileFormat = z.infer<typeof RegistryFileSchema>

const REGISTRY_VERSION = 1

function isValidRegistryFile(value: unknown): value is RegistryFileFormat {
  return RegistryFileSchema.safeParse(value).success
}

interface ProjectRegistryOptions {
  dataDir?: string
  log?: (message: string) => void
}

/**
 * File-based project registry.
 *
 * Maps project paths to their XDG storage directories and persists
 * the mapping to <global-data-dir>/registry.json using atomic writes.
 *
 * Follows the GlobalInstanceManager pattern: sync I/O, in-memory cache,
 * atomic temp+rename for persistence.
 */
export class ProjectRegistry implements IProjectRegistry {
  private readonly dataDir: string
  private readonly log: (message: string) => void
  private readonly projects: Map<string, ProjectInfo> = new Map()
  private readonly projectsDir: string
  private readonly registryPath: string

  constructor(options?: ProjectRegistryOptions) {
    this.dataDir = options?.dataDir ?? getGlobalDataDir()
    this.log = options?.log ?? (() => {})
    this.registryPath = join(this.dataDir, REGISTRY_FILE)
    this.projectsDir = join(this.dataDir, GLOBAL_PROJECTS_DIR)

    this.loadFromDisk()
  }

  get(projectPath: string): ProjectInfo | undefined {
    let resolved: string
    try {
      resolved = resolvePath(projectPath)
    } catch (error) {
      // Only swallow ENOENT — the path no longer exists on disk (e.g. temp dir deleted
      // after agent idle timeout). All other errors (EACCES, ENOTDIR, etc.) are real
      // infrastructure problems and must propagate.
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined
      }

      throw error
    }

    return this.projects.get(resolved)
  }

  getAll(): ReadonlyMap<string, ProjectInfo> {
    return this.projects
  }

  register(projectPath: string): ProjectInfo {
    const resolved = resolvePath(projectPath)

    // Idempotent: return existing if already registered
    const existing = this.projects.get(resolved)
    if (existing) {
      return existing
    }

    const sanitized = sanitizeProjectPath(resolved)
    const storagePath = join(this.projectsDir, sanitized)

    // Validate before side effects — catches root path ('/') which produces
    // an empty sanitizedPath that Zod rejects, preventing mkdirSync from
    // writing sessions/ into the global projects directory itself.
    const info = new ProjectInfo({
      projectPath: resolved,
      registeredAt: Date.now(),
      sanitizedPath: sanitized,
      storagePath,
    })

    // Create per-project XDG directories only after validation succeeds
    mkdirSync(join(storagePath, 'sessions'), {recursive: true})

    this.projects.set(resolved, info)
    this.persistToDisk()

    return info
  }

  unregister(projectPath: string): boolean {
    const resolved = resolvePath(projectPath)

    if (!this.projects.has(resolved)) {
      return false
    }

    this.projects.delete(resolved)
    this.persistToDisk()

    return true
  }

  /**
   * Loads the registry from disk into the in-memory map.
   * Gracefully handles missing or corrupted files by starting with an empty map.
   */
  private loadFromDisk(): void {
    try {
      const content = readFileSync(this.registryPath, 'utf8')
      const parsed: unknown = JSON.parse(content)

      if (!isValidRegistryFile(parsed)) {
        return
      }

      for (const [key, value] of Object.entries(parsed.projects)) {
        if (isValidProjectInfoJson(value)) {
          const info = ProjectInfo.fromJson(value)
          if (info) {
            this.projects.set(key, info)
          }
        }
      }
    } catch {
      // Missing or unreadable file — start empty
    }
  }

  /**
   * Persists the in-memory map to disk via atomic temp+rename.
   */
  private persistToDisk(): void {
    const data: RegistryFileFormat = {
      projects: {},
      version: REGISTRY_VERSION,
    }

    for (const [key, info] of this.projects) {
      data.projects[key] = info.toJson()
    }

    // Ensure data directory exists
    mkdirSync(this.dataDir, {recursive: true})

    // Atomic write: temp file → rename
    const tempPath = this.registryPath + '.tmp.' + process.pid
    try {
      writeFileSync(tempPath, JSON.stringify(data, null, 2))
      renameSync(tempPath, this.registryPath)
    } catch (error) {
      this.log(
        `Failed to persist registry to ${this.registryPath}: ${error instanceof Error ? error.message : String(error)}`,
      )
      // Clean up temp file on failure
      try {
        unlinkSync(tempPath)
      } catch {
        // Ignore cleanup error
      }
    }
  }
}
