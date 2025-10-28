import type {Memory} from '../../core/domain/entities/memory.js'
import type {RetrieveResult} from '../../core/domain/entities/retrieve-result.js'

import {Bullet, type BulletMetadata} from '../../core/domain/entities/bullet.js'
import {Playbook} from '../../core/domain/entities/playbook.js'

/**
 * Transforms a Memory entity into a Bullet entity for playbook storage.
 *
 * Mapping:
 * - memory.bulletId -> bullet.id
 * - memory.section -> bullet.section
 * - memory.content -> bullet.content
 * - memory.tags -> bullet.metadata.tags
 * - memory.nodeKeys -> bullet.metadata.relatedFiles
 * - memory.timestamp -> bullet.metadata.timestamp
 *
 * @param memory The Memory entity to transform
 * @returns A Bullet entity
 */
export const transformMemoryToBullet = (memory: Memory): Bullet => {
  const metadata: BulletMetadata = {
    relatedFiles: [...memory.nodeKeys],
    tags: [...memory.tags],
    timestamp: memory.timestamp,
  }

  return new Bullet(
    memory.bulletId,
    memory.section,
    memory.content,
    metadata,
  )
}

/**
 * Transforms a RetrieveResult into a Playbook.
 *
 * This function:
 * 1. Combines both memories and relatedMemories from the result
 * 2. Transforms each Memory into a Bullet
 * 3. Organizes bullets by section
 * 4. Creates a new Playbook with nextId set to 1 (reset value)
 *
 * @param result The RetrieveResult containing memories from Memora service
 * @returns A Playbook containing all retrieved memories as bullets
 */
export const transformRetrieveResultToPlaybook = (result: RetrieveResult): Playbook => {
  const bulletsMap = new Map<string, Bullet>()
  const sectionsMap = new Map<string, string[]>()

  // Combine all memories (both direct matches and related)
  const allMemories = [...result.memories, ...result.relatedMemories]

  for (const memory of allMemories) {
    // Transform memory to bullet
    const bullet = transformMemoryToBullet(memory)

    // Add to bullets map
    bulletsMap.set(bullet.id, bullet)

    // Add to sections map
    if (!sectionsMap.has(bullet.section)) {
      sectionsMap.set(bullet.section, [])
    }

    sectionsMap.get(bullet.section)!.push(bullet.id)
  }

  // Create playbook with nextId = 1 (reset value, since Memora manages bullet IDs)
  return new Playbook(bulletsMap, sectionsMap, 1)
}
