import type {BulletMetadata} from './bullet.js'
export type OperationType = 'ADD' | 'REMOVE' |'UPDATE'

interface DeltaOperationOptions {
  bulletId?: string
  content?: string
  metadata?: BulletMetadata
}

export interface DeltaOperationJson {
  bulletId?: string
  content?: string
  metadata?: BulletMetadata
  section: string
  type: OperationType
}

/**
 * Represents a single change operation to apply to a playbook.
 */
export class DeltaOperation {
  public readonly bulletId?: string
  public readonly content?: string
  public readonly metadata?: BulletMetadata
  public readonly section: string
  public readonly type: OperationType

  public constructor(
    type: OperationType,
    section: string,
    options: DeltaOperationOptions = {},
  ) {
    const { bulletId, content, metadata } = options

    if (type === 'ADD' && !content) {
      throw new Error('ADD operation requires content')
    }

    if (type === 'UPDATE' && !bulletId) {
      throw new Error('UPDATE operation requires bulletId')
    }

    if (type === 'REMOVE' && !bulletId) {
      throw new Error('REMOVE operation requires bulletId')
    }

    this.type = type
    this.section = section
    this.content = content
    this.bulletId = bulletId
    this.metadata = metadata
  }

  /**
   * Creates a DeltaOperation instance from a JSON object
   */
  public static fromJson(json: DeltaOperationJson): DeltaOperation {
    return new DeltaOperation(
      json.type,
      json.section,
      {
        bulletId: json.bulletId,
        content: json.content,
        metadata: json.metadata,
      },
    )
  }

  public toJson(): DeltaOperationJson {
    const result: DeltaOperationJson = {
      section: this.section,
      type: this.type,
    }

    if (this.content !== undefined) result.content = this.content
    if (this.bulletId !== undefined) result.bulletId = this.bulletId
    if (this.metadata !== undefined) result.metadata = this.metadata

    return result
  }
}
