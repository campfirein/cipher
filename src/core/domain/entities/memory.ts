/**
 * Parameters for creating a Memory instance.
 */
export type MemoryParams = {
  childrenIds: string[]
  content: string
  id: string
  nodeKeys: string[]
  parentIds: string[]
  score: number
  title: string
}

/**
 * Represents a memory retrieved from the ByteRover Memora service.
 * Memories are hierarchical knowledge fragments that can have parent and child relationships.
 */
export class Memory {
  public readonly childrenIds: readonly string[]
  public readonly content: string
  public readonly id: string
  public readonly nodeKeys: readonly string[]
  public readonly parentIds: readonly string[]
  public readonly score: number
  public readonly title: string

  public constructor(params: MemoryParams) {
    if (params.id.trim().length === 0) {
      throw new Error('Memory ID cannot be empty')
    }

    if (params.title.trim().length === 0) {
      throw new Error('Memory title cannot be empty')
    }

    if (params.content.trim().length === 0) {
      throw new Error('Memory content cannot be empty')
    }

    if (params.score < 0 || params.score > 1) {
      throw new Error('Memory score must be between 0.0 and 1.0')
    }

    this.id = params.id
    this.title = params.title
    this.content = params.content
    this.score = params.score
    // Defensive copy to prevent external mutation
    this.nodeKeys = [...params.nodeKeys]
    this.parentIds = [...params.parentIds]
    this.childrenIds = [...params.childrenIds]
  }

  /**
   * Creates a Memory instance from a JSON object.
   * @param json JSON object representing the Memory
   * @returns An instance of Memory
   */
  public static fromJson(json: MemoryParams): Memory {
    return new Memory(json)
  }

  /**
   * Converts the Memory instance to a JSON object.
   * @returns A JSON object representing the Memory
   */
  public toJson(): MemoryParams {
    return {
      childrenIds: [...this.childrenIds],
      content: this.content,
      id: this.id,
      nodeKeys: [...this.nodeKeys],
      parentIds: [...this.parentIds],
      score: this.score,
      title: this.title,
    }
  }
}
