/**
 * ProjectInfo entity — maps a project to its XDG storage location.
 *
 * Each registered project has a unique sanitized directory name under
 * <global-data-dir>/projects/ where runtime data (sessions, SQLite DBs)
 * is stored.
 */
import {z} from 'zod'

/**
 * Zod schema for ProjectInfo validation and serialization.
 */
export const ProjectInfoSchema = z.object({
  projectPath: z.string().refine((s) => s.trim().length > 0, {message: 'ProjectInfo projectPath cannot be empty'}),
  registeredAt: z.number().positive({message: 'ProjectInfo registeredAt must be a positive number'}),
  sanitizedPath: z.string().refine((s) => s.trim().length > 0, {message: 'ProjectInfo sanitizedPath cannot be empty'}),
  storagePath: z.string().refine((s) => s.trim().length > 0, {message: 'ProjectInfo storagePath cannot be empty'}),
})

/**
 * Serialized form of ProjectInfo for persistence in registry.json.
 */
export type ProjectInfoJson = z.infer<typeof ProjectInfoSchema>

/**
 * Type guard for validating parsed JSON as ProjectInfoJson.
 */
export function isValidProjectInfoJson(value: unknown): value is ProjectInfoJson {
  return ProjectInfoSchema.safeParse(value).success
}

/**
 * Represents a registered project and its XDG storage mapping.
 */
export class ProjectInfo {
  public readonly projectPath: string
  public readonly registeredAt: number
  public readonly sanitizedPath: string
  public readonly storagePath: string

  public constructor(params: ProjectInfoJson) {
    const parsed = ProjectInfoSchema.parse(params)
    this.projectPath = parsed.projectPath
    this.sanitizedPath = parsed.sanitizedPath
    this.storagePath = parsed.storagePath
    this.registeredAt = parsed.registeredAt
  }

  /**
   * Deserializes a ProjectInfo from its JSON representation.
   * Returns undefined if the JSON fails validation.
   */
  public static fromJson(json: ProjectInfoJson): ProjectInfo | undefined {
    try {
      return new ProjectInfo(json)
    } catch {
      return undefined
    }
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
