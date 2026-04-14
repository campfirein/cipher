import type {ContributorContext, SystemPromptContributor} from '../../../core/domain/system-prompt/types.js'
import type {MemoryStore} from '../../nclm/memory-store.js'

/**
 * System prompt contributor that injects NCLM working memory state.
 *
 * Generates a lane-budgeted summary of the current memory (summaries, active
 * entries, archived stubs) so the LLM has awareness of what's stored and
 * can use tools.memory.* to read/write.
 */
export class NCLMMemoryContributor implements SystemPromptContributor {
  public readonly id = 'nclm-memory'
  public readonly priority = 18 // After context tree (15), before user memory (20)

  constructor(private readonly memoryStore: MemoryStore) {}

  async getContent(_context: ContributorContext): Promise<string> {
    const st = this.memoryStore.stats()
    if (st.active_count === 0 && st.archived_count === 0) {
      return ''
    }

    return this.memoryStore.buildInjection()
  }
}
