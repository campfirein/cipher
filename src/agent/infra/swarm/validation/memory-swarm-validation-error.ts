/**
 * A single validation issue (error or warning) for a swarm provider.
 */
export type ValidationIssue = {
  /** Config field that caused the issue */
  field?: string
  /** Human-readable description of the issue */
  message: string
  /** Which provider this issue relates to */
  provider?: string
  /** Actionable fix hint */
  suggestion?: string
}

/**
 * Error that accumulates all validation issues instead of failing on the first one.
 * Contains both hard errors (blocking) and soft warnings (informational).
 */
export class MemorySwarmValidationError extends Error {
  public override readonly name = 'MemorySwarmValidationError'

  constructor(
    public readonly errors: ValidationIssue[],
    public readonly warnings: ValidationIssue[],
    public readonly cascadeNote?: string
  ) {
    super(`Memory swarm validation failed with ${errors.length} error(s)`)
  }

  /**
   * Serialize to a plain JSON object for CLI output or logging.
   */
  public toJSON(): {
    cascadeNote?: string
    errors: ValidationIssue[]
    message: string
    warnings: ValidationIssue[]
  } {
    return {
      cascadeNote: this.cascadeNote,
      errors: this.errors,
      message: this.message,
      warnings: this.warnings,
    }
  }
}
