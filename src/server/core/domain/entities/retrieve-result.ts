import {Memory, MemoryParams} from './memory.js'

/**
 * Parameters for creating a RetrieveResult instance.
 */
export type RetrieveResultParams = {
  memories: Memory[]
  relatedMemories: Memory[]
}

/**
 * JSON representation of a RetrieveResult.
 */
export type RetrieveResultJson = {
  memories: MemoryParams[]
  relatedMemories: MemoryParams[]
}

/**
 * Represents the result of a memory retrieval operation from the ByteRover Memora service.
 * Contains both directly matching memories and related memories.
 */
export class RetrieveResult {
  public readonly memories: readonly Memory[]
  public readonly relatedMemories: readonly Memory[]

  public constructor(params: RetrieveResultParams) {
    // Defensive copy to prevent external mutation
    this.memories = [...params.memories]
    this.relatedMemories = [...params.relatedMemories]
  }

  /**
   * Creates a RetrieveResult instance from a JSON object.
   * @param json JSON object representing the RetrieveResult
   * @returns An instance of RetrieveResult
   */
  public static fromJson(json: RetrieveResultJson): RetrieveResult {
    return new RetrieveResult({
      memories: json.memories.map((m) => Memory.fromJson(m)),
      relatedMemories: json.relatedMemories.map((m) => Memory.fromJson(m)),
    })
  }

  /**
   * Converts the RetrieveResult instance to a JSON object.
   * @returns A JSON object representing the RetrieveResult
   */
  public toJson(): RetrieveResultJson {
    return {
      memories: this.memories.map((m) => m.toJson()),
      relatedMemories: this.relatedMemories.map((m) => m.toJson()),
    }
  }
}
