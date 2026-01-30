/**
 * Represents a user in the system.
 */
export class User {
  public readonly email: string
  public readonly id: string
  public readonly name: string

  public constructor(email: string, id: string, name: string) {
    this.email = email
    this.id = id
    this.name = name
  }

  /**
   * Create a User instance from a JSON object.
   * @param json JSON object representing the User
   * @returns An instance of User
   */
  public static fromJson(json: Record<string, string>): User {
    return new User(json.email, json.id, json.name)
  }

  /**
   * Convert the User instance to a JSON object.
   * @returns A JSON object representing the User
   */
  public toJson(): Record<string, string> {
    return {
      email: this.email,
      id: this.id,
      name: this.name,
    }
  }
}
