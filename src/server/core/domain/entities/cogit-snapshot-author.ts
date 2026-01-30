/**
 * Parameters for creating a CogitSnapshotAuthor instance.
 */
export type CogitSnapshotAuthorParams = {
  email: string
  name: string
  when: string
}

/**
 * Represents the author information in a CoGit snapshot.
 */
export class CogitSnapshotAuthor {
  public readonly email: string
  public readonly name: string
  public readonly when: Date

  public constructor(params: CogitSnapshotAuthorParams) {
    this.email = params.email
    this.name = params.name
    this.when = new Date(params.when)
  }

  /**
   * Creates a CogitSnapshotAuthor instance from a JSON object.
   * @param json JSON object representing the author
   * @returns An instance of CogitSnapshotAuthor
   * @throws TypeError if required fields are missing or have invalid types
   */
  public static fromJson(json: unknown): CogitSnapshotAuthor {
    if (!json || typeof json !== 'object') {
      throw new TypeError('CogitSnapshotAuthor JSON must be an object')
    }

    const obj = json as Record<string, unknown>

    if (typeof obj.email !== 'string') {
      throw new TypeError('CogitSnapshotAuthor JSON must have a string email field')
    }

    if (typeof obj.name !== 'string') {
      throw new TypeError('CogitSnapshotAuthor JSON must have a string name field')
    }

    if (typeof obj.when !== 'string') {
      throw new TypeError('CogitSnapshotAuthor JSON must have a string when field')
    }

    return new CogitSnapshotAuthor({
      email: obj.email,
      name: obj.name,
      when: obj.when,
    })
  }
}
