/**
 * Represents a node in the context tree structure.
 * Can be either a folder (with children) or a file.
 */
export interface ContextNode {
  children?: ContextNode[]
  name: string
  path: string
  type: 'file' | 'folder'
}
  
/**
 * Represents the index.json structure for the context tree.
 * This index captures the hierarchical structure of the context tree.
 */
export class ContextTreeIndex {
  public readonly domains: ContextNode[]

  public constructor(domains: ContextNode[]) {
    if (domains.length === 0) {
      throw new Error('Context tree must have at least one domain')
    }

    this.domains = domains
  }

  /**
   * Creates a ContextTreeIndex from JSON format
   */
  public static fromJson(json: Record<string, unknown>): ContextTreeIndex {
    return new ContextTreeIndex(json.domains as ContextNode[])
  }

  /**
   * Serializes the index to JSON format
   */
  public toJson(): Record<string, unknown> {
    return {
      domains: this.domains,
    }
  }
}
