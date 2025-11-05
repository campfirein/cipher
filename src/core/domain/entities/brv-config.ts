import {Space} from './space.js'

/**
 * Represents the configuration stored in .brv/config.json
 * This config links a project directory to a ByteRover space.
 */
export class BrvConfig {
  public readonly createdAt: string
  public readonly spaceId: string
  public readonly spaceName: string
  public readonly teamId: string
  public readonly teamName: string

  // eslint-disable-next-line max-params
  public constructor(createdAt: string, spaceId: string, spaceName: string, teamId: string, teamName: string) {
    if (createdAt.trim().length === 0) {
      throw new Error('Created at cannot be empty')
    }

    if (spaceId.trim().length === 0) {
      throw new Error('Space ID cannot be empty')
    }

    if (spaceName.trim().length === 0) {
      throw new Error('Space name cannot be empty')
    }

    if (teamId.trim().length === 0) {
      throw new Error('Team ID cannot be empty')
    }

    if (teamName.trim().length === 0) {
      throw new Error('Team name cannot be empty')
    }

    this.createdAt = createdAt
    this.spaceId = spaceId
    this.spaceName = spaceName
    this.teamId = teamId
    this.teamName = teamName
  }

  /**
   * Deserializes config from JSON format
   */
  public static fromJson(json: Record<string, string>): BrvConfig {
    return new BrvConfig(json.createdAt, json.spaceId, json.spaceName, json.teamId, json.teamName)
  }

  /**
   * Creates a BrvConfig from a Space entity
   */
  public static fromSpace(space: Space): BrvConfig {
    return new BrvConfig(new Date().toISOString(), space.id, space.name, space.teamId, space.teamName)
  }

  /**
   * Serializes the config to JSON format
   */
  public toJson(): Record<string, string> {
    return {
      createdAt: this.createdAt,
      spaceId: this.spaceId,
      spaceName: this.spaceName,
      teamId: this.teamId,
      teamName: this.teamName,
    }
  }
}
