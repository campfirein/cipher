import type {LegacyRuleDetectionResult} from '../../interfaces/i-legacy-rule-detector.js'

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

export class LegacyRulesDetectedError extends Error {
  public readonly detectionResult: LegacyRuleDetectionResult
  public readonly filePath: string

  public constructor(detectionResult: LegacyRuleDetectionResult, filePath: string) {
    super('Legacy ByteRover rules detected without boundary markers')
    this.name = 'LegacyRulesDetectedError'
    this.detectionResult = detectionResult
    this.filePath = filePath
  }
}
