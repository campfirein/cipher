/**
 * Represents metadata associated with a bullet point
 */
export interface BulletMetadata {
  relatedFiles: string[]
  tags: string[]
  timestamp: string
}

export interface BulletJson {
  content: string
  id: string
  memoryId?: string
  metadata: {
    relatedFiles: string[]
    tags: string[]
    timestamp: string
  }
  section: string
}

/**
 * Represents a single knowledge entry in the playbook.
 * Bullets contain reusable insights, strategies, or lessons learned.
 */
export class Bullet {
  public readonly content: string
  public readonly id: string
  public readonly memoryId?: string
  public readonly metadata: BulletMetadata
  public readonly section: string

  // eslint-disable-next-line max-params
  public constructor(
    id: string,
    section: string,
    content: string,
    metadata: BulletMetadata,
    memoryId?: string,
  ) {
    if (id.trim().length === 0) {
      throw new Error('Bullet ID cannot be empty')
    }

    if (section.trim().length === 0) {
      throw new Error('Bullet section cannot be empty')
    }

    if (content.trim().length === 0) {
      throw new Error('Bullet content cannot be empty')
    }

    if (!metadata.timestamp || metadata.timestamp.trim().length === 0) {
      throw new Error('Bullet metadata timestamp cannot be empty')
    }

    if (!metadata.relatedFiles || !Array.isArray(metadata.relatedFiles)) {
      throw new Error('Bullet metadata relatedFiles must be an array')
    }

    if (!metadata.tags || metadata.tags.length === 0) {
      throw new Error('Bullet metadata tags cannot be empty')
    }

    this.id = id
    this.section = section
    this.content = content
    this.metadata = metadata
    this.memoryId = memoryId
  }

  /**
   * Creates a Bullet instance from a JSON object
   */
  public static fromJson(json: BulletJson): Bullet {
    return new Bullet(
      json.id,
      json.section,
      json.content,
      {
        relatedFiles: json.metadata.relatedFiles,
        tags: json.metadata.tags,
        timestamp: json.metadata.timestamp,
      },
      json.memoryId,
    )
  }

  /**
   * Formats the bullet for display in a playbook
   */
  public toDisplayString(): string {
    const tags = this.metadata.tags.join(', ')
    const tagDisplay = `[Tags: ${tags}]`
    const filesDisplay = this.metadata.relatedFiles.length > 0
      ? `[Files: ${this.metadata.relatedFiles.join(', ')}]`
      : '[Files: none]'
    const timestampDisplay = `[Updated: ${this.metadata.timestamp}]`

    const metadataDisplay = [tagDisplay, filesDisplay, timestampDisplay].join(' ')

    return `- [${this.id}] ${this.content}\n  ${this.section}\n  ${metadataDisplay}`
  }

  /**
   * Converts the bullet to a JSON object
   */
  public toJson(): BulletJson {
    return {
      content: this.content,
      id: this.id,
      memoryId: this.memoryId,
      metadata: {
        relatedFiles: this.metadata.relatedFiles,
        tags: this.metadata.tags,
        timestamp: this.metadata.timestamp,
      },
      section: this.section,
    }
  }

  /**
   * Creates a new bullet with updated content
   */
  public withUpdatedContent(content: string): Bullet {
    return new Bullet(this.id, this.section, content, {
      ...this.metadata,
      timestamp: new Date().toISOString(),
    }, this.memoryId)
  }
}
