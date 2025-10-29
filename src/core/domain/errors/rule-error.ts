export class RuleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RuleError'
  }
}

export class RuleExistsError extends RuleError {
  constructor(message: string = 'Rule already exists') {
    super(message)
    this.name = 'RuleExistsError'
  }
}
