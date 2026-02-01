/**
 * ProjectInfo entity — maps a project to its XDG storage location.
 *
 * Each registered project has a unique sanitized directory name under
 * ~/.local/share/brv/projects/ where runtime data (sessions, SQLite DBs)
 * is stored.
 */

/**
 * Serialized form of ProjectInfo for persistence in registry.json.
 */
export interface ProjectInfoJson {
  readonly projectPath: string
  readonly registeredAt: number
  readonly sanitizedPath: string
  readonly storagePath: string
}

/**
 * Type guard for validating parsed JSON as ProjectInfoJson.
 */
export function isValidProjectInfoJson(value: unknown): value is ProjectInfoJson {
  if (typeof value !== 'object' || value === null) return false
  return (
    'projectPath' in value &&
    typeof value.projectPath === 'string' &&
    'sanitizedPath' in value &&
    typeof value.sanitizedPath === 'string' &&
    'storagePath' in value &&
    typeof value.storagePath === 'string' &&
    'registeredAt' in value &&
    typeof value.registeredAt === 'number'
  )
}

/**
 * Represents a registered project and its XDG storage mapping.
 */
export class ProjectInfo {
  public readonly projectPath: string
  public readonly registeredAt: number
  public readonly sanitizedPath: string
  public readonly storagePath: string

  public constructor(projectPath: string, sanitizedPath: string, storagePath: string, registeredAt: number) {
    if (projectPath.trim().length === 0) {
      throw new Error('ProjectInfo projectPath cannot be empty')
    }

    if (sanitizedPath.trim().length === 0) {
      throw new Error('ProjectInfo sanitizedPath cannot be empty')
    }

    if (storagePath.trim().length === 0) {
      throw new Error('ProjectInfo storagePath cannot be empty')
    }

    if (registeredAt <= 0) {
      throw new Error('ProjectInfo registeredAt must be a positive number')
    }

    this.projectPath = projectPath
    this.sanitizedPath = sanitizedPath
    this.storagePath = storagePath
    this.registeredAt = registeredAt
  }

  /**
   * Deserializes a ProjectInfo from its JSON representation.
   * Returns undefined if the input is invalid.
   */
  public static fromJson(json: ProjectInfoJson): ProjectInfo {
    return new ProjectInfo(json.projectPath, json.sanitizedPath, json.storagePath, json.registeredAt)
  }

  /**
   * Serializes the ProjectInfo to JSON format for persistence.
   */
  public toJson(): ProjectInfoJson {
    return {
      projectPath: this.projectPath,
      registeredAt: this.registeredAt,
      sanitizedPath: this.sanitizedPath,
      storagePath: this.storagePath,
    }
  }
}
