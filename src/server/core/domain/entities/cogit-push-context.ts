/**
 * Valid operation types for CoGit push context.
 */
export type ContextOperation = 'add' | 'delete' | 'edit'

/**
 * Parameters for creating a CogitPushContext instance.
 */
export type CogitPushContextParams = {
  /** LLM-assessed confidence in the accuracy and completeness of this context change. */
  confidence?: 'high' | 'low'
  content: string
  /** Scope of impact of this change. */
  impact?: 'high' | 'low' | 'medium'
  /** Whether this context change should be flagged for human review in the web inbox. */
  needsReview?: boolean
  operation: ContextOperation
  path: string
  /** The agent's stated reason for this change, from the curate operation. */
  reason?: string
  tags: string[]
  title: string
}

/**
 * Type guard to validate operation type.
 */
const isValidOperation = (operation: string): operation is ContextOperation =>
  operation === 'add' || operation === 'edit' || operation === 'delete'

/**
 * Represents a single context file operation in a CoGit push.
 * Used for adding, editing, or deleting context files.
 */
export class CogitPushContext {
  public readonly confidence: 'high' | 'low' | undefined
  public readonly content: string
  public readonly impact: 'high' | 'low' | 'medium' | undefined
  public readonly needsReview: boolean | undefined
  public readonly operation: ContextOperation
  public readonly path: string
  public readonly reason: string | undefined
  public readonly tags: readonly string[]
  public readonly title: string

  public constructor(params: CogitPushContextParams) {
    if (!isValidOperation(params.operation)) {
      throw new Error(`Invalid operation: ${params.operation}. Must be 'add', 'edit', or 'delete'`)
    }

    if (params.path.trim().length === 0) {
      throw new Error('CogitPushContext path cannot be empty')
    }

    // For 'add' operation, content and title are required
    if (params.operation === 'add') {
      if (params.content.trim().length === 0) {
        throw new Error('CogitPushContext content cannot be empty for add operation')
      }

      if (params.title.trim().length === 0) {
        throw new Error('CogitPushContext title cannot be empty for add operation')
      }
    }

    this.operation = params.operation
    this.path = params.path
    this.title = params.title
    this.content = params.content
    // Defensive copy to prevent external mutation
    this.tags = [...params.tags]
    this.confidence = params.confidence
    this.impact = params.impact
    this.needsReview = params.needsReview
    this.reason = params.reason
  }

  /**
   * Creates a CogitPushContext instance from a JSON object.
   * @param json JSON object representing the context
   * @returns An instance of CogitPushContext
   * @throws TypeError if required fields are missing or have invalid types
   */
  public static fromJson(json: unknown): CogitPushContext {
    if (!json || typeof json !== 'object') {
      throw new TypeError('CogitPushContext JSON must be an object')
    }

    const obj = json as Record<string, unknown>

    if (typeof obj.operation !== 'string') {
      throw new TypeError('CogitPushContext JSON must have a string operation field')
    }

    if (typeof obj.path !== 'string') {
      throw new TypeError('CogitPushContext JSON must have a string path field')
    }

    if (typeof obj.title !== 'string') {
      throw new TypeError('CogitPushContext JSON must have a string title field')
    }

    if (typeof obj.content !== 'string') {
      throw new TypeError('CogitPushContext JSON must have a string content field')
    }

    if (!Array.isArray(obj.tags)) {
      throw new TypeError('CogitPushContext JSON must have a tags array')
    }

    const tags = obj.tags.map((tag) => {
      if (typeof tag !== 'string') {
        throw new TypeError('CogitPushContext tags must all be strings')
      }

      return tag
    })

    return new CogitPushContext({
      content: obj.content,
      operation: obj.operation as ContextOperation,
      path: obj.path,
      tags,
      title: obj.title,
    })
  }

  /**
   * Converts the CogitPushContext instance to a JSON object for the API.
   * @returns A JSON object for API serialization
   */
  public toJson(): Record<string, unknown> {
    const json: Record<string, unknown> = {
      content: this.content,
      operation: this.operation,
      path: this.path,
      tags: [...this.tags],
      title: this.title,
    }

    if (this.confidence !== undefined) json.confidence = this.confidence
    if (this.impact !== undefined) json.impact = this.impact
    // eslint-disable-next-line camelcase
    if (this.needsReview !== undefined) json.needs_review = this.needsReview
    if (this.reason !== undefined) json.reason = this.reason

    return json
  }
}
