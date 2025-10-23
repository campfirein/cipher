/**
 * Represents metadata associated with a bullet point
 */
export interface BulletMetadata {
  codebasePath: string
  tags: string[]
  timestamp: string
}

export interface BulletJson {
  content: string
  id: string
  metadata: {
    codebasePath: string
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
  public readonly metadata: BulletMetadata
  public readonly section: string

  public constructor(
    id: string,
    section: string,
    content: string,
    metadata: BulletMetadata,
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

    if (!metadata.codebasePath || metadata.codebasePath.trim().length === 0) {
      throw new Error('Bullet metadata codebase path cannot be empty')
    }

    if (!metadata.tags || metadata.tags.length === 0) {
      throw new Error('Bullet metadata tags cannot be empty')
    }

    this.id = id
    this.section = section
    this.content = content
    this.metadata = metadata
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
        codebasePath: json.metadata.codebasePath,
        tags: json.metadata.tags,
        timestamp: json.metadata.timestamp,
      },
    )
  }

  /**
   * Formats the bullet for display in a playbook
   */
  public toDisplayString(): string {
    const tags = this.metadata.tags.join(', ')
    const tagDisplay = `[Tags: ${tags}]`
    const pathDisplay = `[Path: ${this.metadata.codebasePath}]`
    const timestampDisplay = `[Updated: ${this.metadata.timestamp}]`

    const metadataDisplay = [tagDisplay, pathDisplay, timestampDisplay].join(' ')

    return `- [${this.id}] ${this.content}\n  ${this.section}\n  ${metadataDisplay}`
  }

  /**
   * Converts the bullet to a JSON object
   */
  public toJson(): BulletJson {
    return {
      content: this.content,
      id: this.id,
      metadata: {
        codebasePath: this.metadata.codebasePath,
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
    })
  }
}
