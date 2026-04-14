import type {IMemoryProvider} from '../../core/interfaces/i-memory-provider.js'

/**
 * Write type classification for routing store operations.
 */
export type WriteType = 'entity' | 'general' | 'note'

 

const ENTITY_SIGNALS = /\b(CEO of|CTO of|co-founded|founded|founded by|is a .{0,20} at|president of|VP of|works at)\b/i
const NOTE_SIGNALS = /\b(action items?|draft|idea|meeting notes?|minutes|standup|TODO)\b/i

 

/**
 * Classify content into a write type using lightweight regex rules.
 * Same pattern as classifyQuery() for reads.
 */
export function classifyWrite(content: string): WriteType {
  if (ENTITY_SIGNALS.test(content)) return 'entity'
  if (NOTE_SIGNALS.test(content)) return 'note'

  return 'general'
}

/**
 * Select the best writable provider for a given write type.
 *
 * Filters providers to writable + healthy candidates internally.
 *
 * Priority:
 * - entity → GBrain > first writable
 * - note → first local-markdown > first writable
 * - general → first writable (config order)
 *
 * @returns null if no writable+healthy provider is available
 */
export function selectWriteTarget(
  writeType: WriteType,
  providers: IMemoryProvider[],
  healthCache: Map<string, boolean>
): IMemoryProvider | null {
  // Filter to writable + healthy
  const candidates = providers.filter(
    (p) => p.capabilities.writeSupported && healthCache.get(p.id) !== false
  )

  if (candidates.length === 0) {
    return null
  }

  // Type-specific preference
  if (writeType === 'entity') {
    const gbrain = candidates.find((p) => p.type === 'gbrain')
    if (gbrain) return gbrain
  }

  if (writeType === 'note') {
    const localMd = candidates.find((p) => p.type === 'local-markdown')
    if (localMd) return localMd
  }

  // Fallback: first writable candidate (deterministic by config order)
  return candidates[0]
}
