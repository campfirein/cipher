export interface BulletTag {
  id: string
  tag: string
}

export interface ReflectorOutputInput {
  bulletTags: BulletTag[]
  correctApproach: string
  errorIdentification: string
  hint: string
  keyInsight: string
  reasoning: string
  rootCauseAnalysis: string
}

export interface ReflectorOutputJson {
  bulletTags: BulletTag[]
  correctApproach: string
  errorIdentification: string
  hint: string
  keyInsight: string
  reasoning: string
  rootCauseAnalysis: string
}

/**
 * Output from the reflector phase.
 * Contains error analysis and bullet tagging.
 */
export class ReflectorOutput {
  public readonly bulletTags: BulletTag[]
  public readonly correctApproach: string
  public readonly errorIdentification: string
  public readonly hint: string
  public readonly keyInsight: string
  public readonly reasoning: string
  public readonly rootCauseAnalysis: string

  public constructor(input: ReflectorOutputInput) {
    this.reasoning = input.reasoning
    this.errorIdentification = input.errorIdentification
    this.rootCauseAnalysis = input.rootCauseAnalysis
    this.correctApproach = input.correctApproach
    this.keyInsight = input.keyInsight
    this.hint = input.hint
    this.bulletTags = [...input.bulletTags]
  }

  public static fromJson(json: ReflectorOutputJson): ReflectorOutput {
    return new ReflectorOutput({
      bulletTags: json.bulletTags,
      correctApproach: json.correctApproach,
      errorIdentification: json.errorIdentification,
      hint: json.hint || '',
      keyInsight: json.keyInsight,
      reasoning: json.reasoning,
      rootCauseAnalysis: json.rootCauseAnalysis,
    })
  }

  public toJson(): ReflectorOutputJson {
    return {
      bulletTags: this.bulletTags,
      correctApproach: this.correctApproach,
      errorIdentification: this.errorIdentification,
      hint: this.hint,
      keyInsight: this.keyInsight,
      reasoning: this.reasoning,
      rootCauseAnalysis: this.rootCauseAnalysis,
    }
  }
}
