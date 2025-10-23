export interface ExecutorOutputJson {
  bulletIds: string[]
  finalAnswer: string
  reasoning: string
  toolUsage: string[]
}

/**
 * Output from the executor (the coding agent) phase.
 * Contains reasoning, final answer, and bullets referenced.
 */
export class ExecutorOutput {
  public readonly bulletIds: string[]
  public readonly finalAnswer: string
  public readonly reasoning: string
  public readonly toolUsage: string[]

  public constructor(reasoning: string, finalAnswer: string, bulletIds: string[], toolUsage: string[]) {
    if (reasoning.trim().length === 0) {
      throw new Error('Executor reasoning cannot be empty')
    }

    if (finalAnswer.trim().length === 0) {
      throw new Error('Executor final answer cannot be empty')
    }

    this.reasoning = reasoning
    this.finalAnswer = finalAnswer
    this.bulletIds = [...bulletIds]
    this.toolUsage = [...toolUsage]
  }
  
  public toJson(): ExecutorOutputJson {
    return {
      bulletIds: this.bulletIds,
      finalAnswer: this.finalAnswer,
      reasoning: this.reasoning,
      toolUsage: this.toolUsage,
    }
  }
}
