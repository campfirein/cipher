import {mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'

import type {IProjectRegistry} from '../../core/interfaces/project/i-project-registry.js'

import {GLOBAL_PROJECTS_DIR, REGISTRY_FILE} from '../../constants.js'
import {isValidProjectInfoJson, ProjectInfo} from '../../core/domain/project/project-info.js'
import {getGlobalDataDir} from '../../utils/global-data-path.js'
import {resolvePath, sanitizeProjectPath} from '../../utils/path-utils.js'

/**
 * Expected shape of registry.json on disk.
 */
interface RegistryFileFormat {
  projects: Record<string, unknown>
  version: number
}

const REGISTRY_VERSION = 1

/**
 * Type guard for the registry file format.
 */
function isValidRegistryFile(value: unknown): value is RegistryFileFormat {
  if (typeof value !== 'object' || value === null) return false
  return (
    'version' in value &&
    typeof value.version === 'number' &&
    'projects' in value &&
    typeof value.projects === 'object' &&
    value.projects !== null
  )
}

type ProjectRegistryOptions = {
  dataDir?: string
}

/**
 * File-based project registry.
 *
 * Maps project paths to their XDG storage directories and persists
 * the mapping to ~/.local/share/brv/registry.json using atomic writes.
 *
 * Follows the GlobalInstanceManager pattern: sync I/O, in-memory cache,
 * atomic temp+rename for persistence.
 */
export class ProjectRegistry implements IProjectRegistry {
  private readonly dataDir: string
  private readonly projects: Map<string, ProjectInfo> = new Map()
  private readonly projectsDir: string
  private readonly registryPath: string

  constructor(options?: ProjectRegistryOptions) {
    this.dataDir = options?.dataDir ?? getGlobalDataDir()
    this.registryPath = join(this.dataDir, REGISTRY_FILE)
    this.projectsDir = join(this.dataDir, GLOBAL_PROJECTS_DIR)

    this.loadFromDisk()
  }

  get(projectPath: string): ProjectInfo | undefined {
    const resolved = resolvePath(projectPath)
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

    // Create per-project XDG directories
    mkdirSync(join(storagePath, 'sessions'), {recursive: true})

    const info = new ProjectInfo(resolved, sanitized, storagePath, Date.now())
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
          try {
            this.projects.set(key, ProjectInfo.fromJson(value))
          } catch {
            // Skip invalid entries
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
    } catch {
      // Clean up temp file on failure
      try {
        unlinkSync(tempPath)
      } catch {
        // Ignore cleanup error
      }
    }
  }
}
