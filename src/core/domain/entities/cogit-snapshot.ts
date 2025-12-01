import {CogitSnapshotAuthor} from './cogit-snapshot-author.js'
import {CogitSnapshotFile} from './cogit-snapshot-file.js'

/**
 * Parameters for creating a CogitSnapshot instance.
 */
export type CogitSnapshotParams = {
  author: CogitSnapshotAuthor
  branch: string
  commitSha: string
  files: CogitSnapshotFile[]
  message: string
}

/**
 * Represents a complete CoGit snapshot response.
 */
export class CogitSnapshot {
  public readonly author: CogitSnapshotAuthor
  public readonly branch: string
  public readonly commitSha: string
  public readonly files: readonly CogitSnapshotFile[]
  public readonly message: string

  public constructor(params: CogitSnapshotParams) {
    this.author = params.author
    this.branch = params.branch
    this.commitSha = params.commitSha
    // Defensive copy to prevent external mutation
    this.files = [...params.files]
    this.message = params.message
  }

  /**
   * Creates a CogitSnapshot instance from a JSON object.
   * Handles snake_case API response format (commit_sha -> commitSha).
   * @param json JSON object representing the snapshot
   * @returns An instance of CogitSnapshot
   * @throws TypeError if required fields are missing or have invalid types
   */
  public static fromJson(json: unknown): CogitSnapshot {
    if (!json || typeof json !== 'object') {
      throw new TypeError('CogitSnapshot JSON must be an object')
    }

    const obj = json as Record<string, unknown>

    if (typeof obj.branch !== 'string') {
      throw new TypeError('CogitSnapshot JSON must have a string branch field')
    }

    // Handle snake_case from API
    if (typeof obj.commit_sha !== 'string') {
      throw new TypeError('CogitSnapshot JSON must have a string commit_sha field')
    }

    if (typeof obj.message !== 'string') {
      throw new TypeError('CogitSnapshot JSON must have a string message field')
    }

    if (!Array.isArray(obj.files)) {
      throw new TypeError('CogitSnapshot JSON must have a files array')
    }

    if (!obj.author || typeof obj.author !== 'object') {
      throw new TypeError('CogitSnapshot JSON must have an author object')
    }

    const files = obj.files.map((file) => CogitSnapshotFile.fromJson(file))
    const author = CogitSnapshotAuthor.fromJson(obj.author)

    return new CogitSnapshot({
      author,
      branch: obj.branch,
      commitSha: obj.commit_sha,
      files,
      message: obj.message,
    })
  }
}
