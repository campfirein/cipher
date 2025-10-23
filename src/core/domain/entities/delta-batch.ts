import {DeltaOperation, type DeltaOperationJson, type OperationType} from './delta-operation.js'

export interface DeltaBatchJson {
  operations: DeltaOperationJson[]
  reasoning: string
}

/**
 * Represents a batch of delta operations with curator reasoning.
 */
export class DeltaBatch {
  public readonly operations: DeltaOperation[]
  public readonly reasoning: string

  public constructor(reasoning: string, operations: DeltaOperation[]) {
    if (reasoning.trim().length === 0) {
      throw new Error('Delta batch reasoning cannot be empty')
    }

    this.reasoning = reasoning
    this.operations = [...operations]
  }

  /**
   * Creates a DeltaBatch instance from a JSON object
   */
  public static fromJson(json: DeltaBatchJson): DeltaBatch {
    const operations = (json.operations ?? []).map((op) => DeltaOperation.fromJson(op))
    return new DeltaBatch(
      json.reasoning,
      operations,
    )
  }

  /**
   * Returns the count of operations
   */
  public getOperationCount(): number {
    return this.operations.length
  }

  /**
   * Returns operations grouped by type
   */
  public getOperationsByType(): Record<OperationType, DeltaOperation[]> {
    const result = {} as Record<OperationType, DeltaOperation[]>
    for (const op of this.operations) {
      if (!result[op.type]) result[op.type] = []
      result[op.type].push(op)
    }

    return result
  }

  /**
   * Returns true if the batch has no operations
   */
  public isEmpty(): boolean {
    return this.operations.length === 0
  }

  public toJson(): DeltaBatchJson {
    return {
      operations: this.operations.map((op) => op.toJson()),
      reasoning: this.reasoning,
    }
  }
}
