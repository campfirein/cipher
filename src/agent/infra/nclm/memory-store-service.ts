/* eslint-disable camelcase */
import type {MemoryStore} from './memory-store.js'
import type {CompactResult, ListParams, MemoryEntry, MemoryStats, ScoredEntry} from './memory-types.js'

/**
 * Service interface for MemoryStore operations in the sandbox.
 * Translates positional-argument calls from sandbox code into
 * MemoryStore's object-parameter methods.
 */
export interface IMemoryStoreService {
  archive(id: string): void
  compact(tag?: string): CompactResult
  free(id: string): void
  latest(tag?: string): MemoryEntry | null
  list(params?: ListParams): MemoryEntry[]
  read(id: string): MemoryEntry | null
  search(query: string, topK?: number, tags?: string[], includeArchived?: boolean): ScoredEntry[]
  stats(): MemoryStats
  update(id: string, fields: {content?: string; importance?: number; tags?: string[]; title?: string}): MemoryEntry
  write(title: string, content: string, tags?: string[], importance?: number): MemoryEntry
}

/**
 * Creates a MemoryStoreService that adapts sandbox-friendly positional arguments
 * to MemoryStore's structured parameter objects.
 */
export function createMemoryStoreService(memoryStore: MemoryStore): IMemoryStoreService {
  return {
    archive(id: string): void {
      memoryStore.archive(id)
    },

    compact(tag?: string): CompactResult {
      return memoryStore.compact(tag)
    },

    free(id: string): void {
      memoryStore.free(id)
    },

    latest(tag?: string): MemoryEntry | null {
      return memoryStore.latest(tag)
    },

    list(params?: ListParams): MemoryEntry[] {
      return memoryStore.list(params)
    },

    read(id: string): MemoryEntry | null {
      return memoryStore.read(id)
    },

    search(query: string, topK?: number, tags?: string[], includeArchived?: boolean): ScoredEntry[] {
      return memoryStore.search({
        include_archived: includeArchived,
        query,
        tags,
        top_k: topK,
      })
    },

    stats(): MemoryStats {
      return memoryStore.stats()
    },

    update(id: string, fields: {content?: string; importance?: number; tags?: string[]; title?: string}): MemoryEntry {
      return memoryStore.update({id, ...fields})
    },

    write(title: string, content: string, tags?: string[], importance?: number): MemoryEntry {
      return memoryStore.write({content, importance, tags, title})
    },
  }
}
