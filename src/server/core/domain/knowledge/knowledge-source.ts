import {createHash} from 'node:crypto'

export interface KnowledgeSource {
  alias?: string
  contextTreeRoot: string
  sourceKey: string
  type: 'linked' | 'local'
}

export interface LoadedKnowledgeSources {
  mtime: number
  sources: KnowledgeSource[]
}

/**
 * Derives a stable, short source key from a canonical path.
 * Uses first 12 hex chars of SHA-256 to avoid alias-based collisions.
 */
export function deriveSourceKey(canonicalPath: string): string {
  return createHash('sha256').update(canonicalPath).digest('hex').slice(0, 12)
}
