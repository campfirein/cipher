/**
 * Parameters for creating a User instance
 */
interface UserParams {
  email: string
  hasOnboardedCli: boolean
  id: string
  name: string
}

/**
 * Represents a user in the system.
 */
export class User {
  public readonly email: string
  public readonly hasOnboardedCli: boolean
  public readonly id: string
  public readonly name: string

  public constructor(params: UserParams) {
    this.email = params.email
    this.hasOnboardedCli = params.hasOnboardedCli
    this.id = params.id
    this.name = params.name
  }

  /**
   * Create a User instance from a JSON object.
   * @param json JSON object representing the User
   * @returns An instance of User
   */
  public static fromJson(json: Record<string, unknown>): User {
    if (typeof json.email !== 'string') {
      throw new TypeError('User JSON must have a string email field')
    }

    if (typeof json.id !== 'string') {
      throw new TypeError('User JSON must have a string id field')
    }

    if (typeof json.name !== 'string') {
      throw new TypeError('User JSON must have a string name field')
    }

    if (typeof json.has_onboarded_cli !== 'boolean') {
      throw new TypeError('User JSON must have a boolean has_onboarded_cli field')
    }

    return new User({
      email: json.email,
      hasOnboardedCli: json.has_onboarded_cli,
      id: json.id,
      name: json.name,
    })
  }

  /**
   * Convert the User instance to a JSON object.
   * @returns A JSON object representing the User
   */
  public toJson(): Record<string, unknown> {
    return {
      email: this.email,
      hasOnboardedCli: this.hasOnboardedCli,
      id: this.id,
      name: this.name,
    }
  }
}
