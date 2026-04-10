/**
 * Thrown when swarm spec validation finds one or more errors.
 * Carries all errors and warnings collected during validation,
 * plus an optional info note for cascade context.
 */
export class SwarmValidationError extends Error {
  readonly errors: string[]
  readonly note: null | string
  readonly warnings: string[]

  constructor(errors: string[], warnings: string[] = [], note: null | string = null) {
    super(errors.join('\n'))
    this.name = 'SwarmValidationError'
    this.errors = errors
    this.note = note
    this.warnings = warnings
  }
}
