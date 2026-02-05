/**
 * Parameters for creating a Space instance
 */
interface SpaceParams {
  id: string
  isDefault: boolean
  name: string
  teamId: string
  teamName: string
}

/**
 * Represents a ByteRover space that belongs to a team.
 * A space corresponds to a user's codebase and contains memories for that codebase.
 */
export class Space {
  public readonly id: string
  public readonly isDefault: boolean
  public readonly name: string
  public readonly teamId: string
  public readonly teamName: string

  public constructor(params: SpaceParams) {
    if (params.id.trim().length === 0) {
      throw new Error('Space ID cannot be empty')
    }

    if (params.name.trim().length === 0) {
      throw new Error('Space name cannot be empty')
    }

    if (params.teamId.trim().length === 0) {
      throw new Error('Team ID cannot be empty')
    }

    if (params.teamName.trim().length === 0) {
      throw new Error('Team name cannot be empty')
    }

    this.id = params.id
    this.isDefault = params.isDefault
    this.name = params.name
    this.teamId = params.teamId
    this.teamName = params.teamName
  }

  /**
   * Deserializes a space from JSON format
   */
  public static fromJson(json: Record<string, unknown>): Space {
    if (typeof json.id !== 'string') {
      throw new TypeError('Space JSON must have a string id field')
    }

    if (typeof json.is_default !== 'boolean') {
      throw new TypeError('Space JSON must have a boolean is_default field')
    }

    if (typeof json.name !== 'string') {
      throw new TypeError('Space JSON must have a string name field')
    }

    if (typeof json.team_id !== 'string') {
      throw new TypeError('Space JSON must have a string team_id field')
    }

    if (typeof json.team_name !== 'string') {
      throw new TypeError('Space JSON must have a string team_name field')
    }

    return new Space({
      id: json.id,
      isDefault: json.is_default,
      name: json.name,
      teamId: json.team_id,
      teamName: json.team_name,
    })
  }

  /**
   * Returns the display name in the format: teamName/spaceName
   * Example: "acme-corp/frontend-app"
   */
  public getDisplayName(): string {
    return `${this.teamName}/${this.name}`
  }

  /**
   * Serializes the space to JSON format
   */
  public toJson(): Record<string, unknown> {
    return {
      id: this.id,
      isDefault: this.isDefault,
      name: this.name,
      teamId: this.teamId,
      teamName: this.teamName,
    }
  }
}
