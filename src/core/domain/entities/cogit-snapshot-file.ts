/**
 * Parameters for creating a CogitSnapshotFile instance.
 */
export type CogitSnapshotFileParams = {
  content: string
  mode: string
  path: string
  sha: string
  size: number
}

/**
 * Represents a single file in a CoGit snapshot.
 * Content is base64-encoded.
 */
export class CogitSnapshotFile {
  public readonly content: string
  public readonly mode: string
  public readonly path: string
  public readonly sha: string
  public readonly size: number

  public constructor(params: CogitSnapshotFileParams) {
    this.content = params.content
    this.mode = params.mode
    this.path = params.path
    this.sha = params.sha
    this.size = params.size
  }

  /**
   * Creates a CogitSnapshotFile instance from a JSON object.
   * @param json JSON object representing the file
   * @returns An instance of CogitSnapshotFile
   * @throws TypeError if required fields are missing or have invalid types
   */
  public static fromJson(json: unknown): CogitSnapshotFile {
    if (!json || typeof json !== 'object') {
      throw new TypeError('CogitSnapshotFile JSON must be an object')
    }

    const obj = json as Record<string, unknown>

    if (typeof obj.content !== 'string') {
      throw new TypeError('CogitSnapshotFile JSON must have a string content field')
    }

    if (typeof obj.mode !== 'string') {
      throw new TypeError('CogitSnapshotFile JSON must have a string mode field')
    }

    if (typeof obj.path !== 'string') {
      throw new TypeError('CogitSnapshotFile JSON must have a string path field')
    }

    if (typeof obj.sha !== 'string') {
      throw new TypeError('CogitSnapshotFile JSON must have a string sha field')
    }

    if (typeof obj.size !== 'number') {
      throw new TypeError('CogitSnapshotFile JSON must have a number size field')
    }

    return new CogitSnapshotFile({
      content: obj.content,
      mode: obj.mode,
      path: obj.path,
      sha: obj.sha,
      size: obj.size,
    })
  }

  /**
   * Decodes the base64 content to a UTF-8 string.
   * @returns Decoded file content
   */
  public decodeContent(): string {
    return Buffer.from(this.content, 'base64').toString('utf8')
  }
}
