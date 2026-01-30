/**
 * Represents a ByteRover space that belongs to a team.
 * A space corresponds to a user's codebase and contains memories for that codebase.
 */
export class Space {
  public readonly id: string
  public readonly name: string
  public readonly teamId: string
  public readonly teamName: string

  public constructor(id: string, name: string, teamId: string, teamName: string) {
    if (id.trim().length === 0) {
      throw new Error('Space ID cannot be empty')
    }

    if (name.trim().length === 0) {
      throw new Error('Space name cannot be empty')
    }

    if (teamId.trim().length === 0) {
      throw new Error('Team ID cannot be empty')
    }

    if (teamName.trim().length === 0) {
      throw new Error('Team name cannot be empty')
    }

    this.id = id
    this.name = name
    this.teamId = teamId
    this.teamName = teamName
  }

  /**
   * Deserializes a space from JSON format
   */
  public static fromJson(json: Record<string, string>): Space {
    return new Space(json.id, json.name, json.teamId, json.teamName)
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
  public toJson(): Record<string, string> {
    return {
      id: this.id,
      name: this.name,
      teamId: this.teamId,
      teamName: this.teamName,
    }
  }
}
