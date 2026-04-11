/**
 * Parameters for creating a Team instance
 */
interface TeamParams {
  avatarUrl: string
  createdAt: Date
  description: string
  displayName: string
  id: string
  isActive: boolean
  isDefault: boolean
  name: string
  slug: string
  updatedAt: Date
}

/**
 * Represents a ByteRover team that contains spaces.
 * A team is a group of users collaborating on one or more codebases.
 */
export class Team {
  public readonly avatarUrl: string
  public readonly createdAt: Date
  public readonly description: string
  public readonly displayName: string
  public readonly id: string
  public readonly isActive: boolean
  public readonly isDefault: boolean
  public readonly name: string
  public readonly slug: string
  public readonly updatedAt: Date

  public constructor(params: TeamParams) {
    if (params.id.trim().length === 0) {
      throw new Error('Team ID cannot be empty')
    }

    if (params.name.trim().length === 0) {
      throw new Error('Team name cannot be empty')
    }

    if (params.displayName.trim().length === 0) {
      throw new Error('Team display name cannot be empty')
    }

    this.avatarUrl = params.avatarUrl
    this.createdAt = params.createdAt
    this.description = params.description
    this.displayName = params.displayName
    this.id = params.id
    this.isActive = params.isActive
    this.isDefault = params.isDefault
    this.name = params.name
    this.slug = params.slug
    this.updatedAt = params.updatedAt
  }

  /**
   * Deserializes a team from JSON format (API response with snake_case)
   */
  public static fromJson(json: Record<string, unknown>): Team {
    // Validate required fields
    if (typeof json.id !== 'string') {
      throw new TypeError('Team JSON must have a string id field')
    }

    if (typeof json.name !== 'string') {
      throw new TypeError('Team JSON must have a string name field')
    }

    if (typeof json.display_name !== 'string') {
      throw new TypeError('Team JSON must have a string display_name field')
    }

    if (typeof json.is_active !== 'boolean') {
      throw new TypeError('Team JSON must have a boolean is_active field')
    }

    if (typeof json.created_at !== 'string') {
      throw new TypeError('Team JSON must have a string created_at field')
    }

    if (typeof json.updated_at !== 'string') {
      throw new TypeError('Team JSON must have a string updated_at field')
    }

    if (typeof json.is_default !== 'boolean') {
      throw new TypeError('Team JSON must have a boolean is_default field')
    }

    return new Team({
      avatarUrl: typeof json.avatar_url === 'string' ? json.avatar_url : '',
      createdAt: new Date(json.created_at),
      description: typeof json.description === 'string' ? json.description : '',
      displayName: json.display_name,
      id: json.id,
      isActive: json.is_active,
      isDefault: json.is_default,
      name: json.name,
      slug: typeof json.slug === 'string' ? json.slug : json.name,
      updatedAt: new Date(json.updated_at),
    })
  }

  /**
   * Returns the display name for UI purposes
   * Example: "Acme Corporation"
   */
  public getDisplayName(): string {
    return this.displayName
  }

  /**
   * Serializes the team to JSON format (camelCase for storage)
   */
  public toJson(): Record<string, unknown> {
    return {
      avatarUrl: this.avatarUrl,
      createdAt: this.createdAt.toISOString(),
      description: this.description,
      displayName: this.displayName,
      id: this.id,
      isActive: this.isActive,
      isDefault: this.isDefault,
      name: this.name,
      slug: this.slug,
      updatedAt: this.updatedAt.toISOString(),
    }
  }
}
