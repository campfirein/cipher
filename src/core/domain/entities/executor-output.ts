export interface ExecutorOutputJson {
  bulletIds: string[]
  finalAnswer: string
  hint: string
  reasoning: string
  toolUsage: string[]
}

export interface ExecutorOutputOptions {
  bulletIds?: string[]
  finalAnswer: string
  hint: string
  reasoning: string
  toolUsage?: string[]
}

/**
 * Output from the executor (the coding agent) phase.
 * Contains reasoning, final answer, and bullets referenced.
 */
export class ExecutorOutput {
  public readonly bulletIds: string[]
  public readonly finalAnswer: string
  public readonly hint: string
  public readonly reasoning: string
  public readonly toolUsage: string[]

  public constructor(options: ExecutorOutputOptions) {
    if (options.reasoning.trim().length === 0) {
      throw new Error('Executor reasoning cannot be empty')
    }

    if (options.finalAnswer.trim().length === 0) {
      throw new Error('Executor final answer cannot be empty')
    }

    this.hint = options.hint
    this.reasoning = options.reasoning
    this.finalAnswer = options.finalAnswer
    this.bulletIds = [...(options.bulletIds ?? [])]
    this.toolUsage = [...(options.toolUsage ?? [])]
  }
  
  public toJson(): ExecutorOutputJson {
    return {
      bulletIds: this.bulletIds,
      finalAnswer: this.finalAnswer,
      hint: this.hint,
      reasoning: this.reasoning,
      toolUsage: this.toolUsage,
    }
  }
}
