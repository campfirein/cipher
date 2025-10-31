import type {DeltaBatch} from './delta-batch.js'
import type {DeltaOperation} from './delta-operation.js'

import {Bullet, type BulletJson, type BulletMetadata} from './bullet.js'

export interface PlaybookJson {
  bullets: Record<string, BulletJson>
  nextId: number
  sections: Record<string, string[]>
}

export interface PlaybookStats {
  bullets: number
  sections: number
  tags: string[]
}

/**
 * The central knowledge repository that stores and manages bullets.
 * Playbooks are organized into sections and support delta operations.
 * Playbooks are used as an temporary notes then will be pushed to byterover for usage
 */
export class Playbook {
  private readonly bullets: Map<string, Bullet>
  private nextId: number
  private readonly sections: Map<string, string[]>

  public constructor(
    bullets: Map<string, Bullet> = new Map(),
    sections: Map<string, string[]> = new Map(),
    nextId: number = 1,
  ) {
    this.bullets = new Map(bullets)
    this.sections = new Map(sections)
    this.nextId = nextId
  }

  // ===== Static Factory Methods =====

  /**
   * Creates a Playbook instance from a JSON object
   */
  public static fromJson(json: PlaybookJson): Playbook {
    const bullets = new Map<string, Bullet>()
    const sections = new Map<string, string[]>()

    // Deserialize bullets
    for (const [id, bulletData] of Object.entries(json.bullets ?? {})) {
      bullets.set(id, Bullet.fromJson(bulletData))
    }

    // Deserialize sections
    for (const [section, bulletIds] of Object.entries(json.sections ?? {})) {
      sections.set(section, bulletIds)
    }

    return new Playbook(bullets, sections, json.nextId ?? 1)
  }

  /**
   * Deserializes from JSON string
   */
  public static loads(data: string): Playbook {
    const json = JSON.parse(data) as PlaybookJson
    return Playbook.fromJson(json)
  }

  // ===== CRUD Operations =====

  /**
   * Adds a new bullet to the playbook
   */
  public addBullet(section: string, content: string, bulletId?: string, metadata?: BulletMetadata): Bullet {
    const id = bulletId ?? this._generateId(section)
    const now = new Date().toISOString()

    // Create metadata with defaults if not provided
    const bulletMetadata: BulletMetadata = metadata ?? {
      relatedFiles: [],
      tags: [],
      timestamp: now,
    }

    const bullet = new Bullet(id, section, content, bulletMetadata, undefined)

    // Add to bullets map
    this.bullets.set(id, bullet)

    // Add to sections map
    if (!this.sections.has(section)) {
      this.sections.set(section, [])
    }

    this.sections.get(section)!.push(id)

    return bullet
  }

  /**
   * Adds a tag to a bullet
   */
  public addTagToBullet(bulletId: string, tag: string): Bullet | undefined {
    const bullet = this.bullets.get(bulletId)
    if (!bullet) return undefined

    // Check if tag already exists
    if (bullet.metadata.tags.includes(tag)) {
      return bullet
    }

    const updatedMetadata: BulletMetadata = {
      ...bullet.metadata,
      tags: [...bullet.metadata.tags, tag],
      timestamp: new Date().toISOString(),
    }

    const updatedBullet = new Bullet(bullet.id, bullet.section, bullet.content, updatedMetadata, bullet.memoryId)

    this.bullets.set(bulletId, updatedBullet)
    return updatedBullet
  }

  /**
   * Applies a batch of delta operations to the playbook
   */
  public applyDelta(delta: DeltaBatch): void {
    for (const operation of delta.operations) {
      this._applyOperation(operation)
    }
  }

  /**
   * Converts playbook to markdown format for LLM prompts
   */
  public asPrompt(): string {
    const sections = this.getSections()

    if (sections.length === 0) {
      return '(Empty playbook)'
    }

    const lines: string[] = []

    for (const section of sections) {
      lines.push(`## ${section}`)
      const bullets = this.getBulletsInSection(section)
      for (const bullet of bullets) {
        lines.push(bullet.toDisplayString())
      }

      lines.push('') // Empty line between sections
    }

    return lines.join('\n').trim()
  }

  /**
   * Serializes to JSON string (pretty-printed)
   */
  public dumps(): string {
    return JSON.stringify(this.toJson(), null, 2)
  }

  /**
   * Retrieves a single bullet by ID
   */
  public getBullet(bulletId: string): Bullet | undefined {
    return this.bullets.get(bulletId)
  }

  /**
   * Returns all bullets as an array
   */
  public getBullets(): Bullet[] {
    return [...this.bullets.values()]
  }

  /**
   * Returns bullets in a specific section
   */
  public getBulletsInSection(section: string): Bullet[] {
    const bulletIds = this.sections.get(section) ?? []
    return bulletIds.map((id) => this.bullets.get(id)).filter((b): b is Bullet => b !== undefined)
  }

  /**
   * Returns all section names
   */
  public getSections(): string[] {
    return [...this.sections.keys()].sort()
  }

  // ===== Delta Operations =====

  /**
   * Removes a bullet from the playbook
   */
  public removeBullet(bulletId: string): void {
    const bullet = this.bullets.get(bulletId)
    if (!bullet) return

    // Remove from bullets map
    this.bullets.delete(bulletId)

    // Remove from sections map
    const sectionBullets = this.sections.get(bullet.section)
    if (sectionBullets) {
      const index = sectionBullets.indexOf(bulletId)
      if (index !== -1) {
        sectionBullets.splice(index, 1)
      }

      // Clean up empty sections
      if (sectionBullets.length === 0) {
        this.sections.delete(bullet.section)
      }
    }
  }

  /**
   * Removes a tag from a bullet
   */
  public removeTagFromBullet(bulletId: string, tag: string): Bullet | undefined {
    const bullet = this.bullets.get(bulletId)
    if (!bullet) return undefined

    const updatedMetadata: BulletMetadata = {
      ...bullet.metadata,
      tags: bullet.metadata.tags.filter((t) => t !== tag),
      timestamp: new Date().toISOString(),
    }

    const updatedBullet = new Bullet(bullet.id, bullet.section, bullet.content, updatedMetadata, bullet.memoryId)

    this.bullets.set(bulletId, updatedBullet)
    return updatedBullet
  }

  // ===== Presentation =====

  /**
   * Returns playbook statistics
   */
  public stats(): PlaybookStats {
    const tagsSet = new Set<string>()

    for (const bullet of this.bullets.values()) {
      for (const tag of bullet.metadata.tags) {
        tagsSet.add(tag)
      }
    }

    return {
      bullets: this.bullets.size,
      sections: this.sections.size,
      tags: [...tagsSet].sort(),
    }
  }

  public toJson(): PlaybookJson {
    const bulletsObj: Record<string, BulletJson> = {}
    for (const [id, bullet] of this.bullets) {
      bulletsObj[id] = bullet.toJson()
    }

    const sectionsObj: Record<string, string[]> = {}
    for (const [section, bulletIds] of this.sections) {
      sectionsObj[section] = [...bulletIds]
    }

    return {
      bullets: bulletsObj,
      nextId: this.nextId,
      sections: sectionsObj,
    }
  }

  // ===== Serialization =====

  /**
   * Updates an existing bullet's content and/or metadata
   */
  public updateBullet(
    bulletId: string,
    options: {
      content?: string
      metadata?: BulletMetadata
    },
  ): Bullet | undefined {
    const bullet = this.bullets.get(bulletId)
    if (!bullet) return undefined

    const updatedMetadata: BulletMetadata = options.metadata ?? {
      ...bullet.metadata,
      timestamp: new Date().toISOString(),
    }

    const updatedBullet = new Bullet(
      bullet.id,
      bullet.section,
      options.content ?? bullet.content,
      updatedMetadata,
      bullet.memoryId,
    )

    this.bullets.set(bulletId, updatedBullet)
    return updatedBullet
  }

  private _applyOperation(operation: DeltaOperation): void {
    switch (operation.type) {
      case 'ADD': {
        this.addBullet(operation.section, operation.content!, operation.bulletId, operation.metadata)
        break
      }

      case 'REMOVE': {
        this.removeBullet(operation.bulletId!)
        break
      }

      case 'UPDATE': {
        this.updateBullet(operation.bulletId!, {
          content: operation.content,
          metadata: operation.metadata,
        })
        break
      }
    }
  }

  // ===== Private Helpers =====

  private _generateId(section: string): string {
    // Convert section to prefix: "Common Errors" -> "common"
    const prefix = section
      .toLowerCase()
      .split(' ')[0]
      .replaceAll(/[^a-z0-9]/g, '')
    const id = `${prefix}-${String(this.nextId).padStart(5, '0')}`
    this.nextId++
    return id
  }
}
