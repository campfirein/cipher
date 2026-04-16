import {randomUUID} from 'node:crypto'
import {mkdir, readFile, rename, writeFile} from 'node:fs/promises'
import {dirname, join, resolve} from 'node:path'

import {AsyncMutex} from '../../../agent/infra/llm/context/async-mutex.js'
import {type DreamState, DreamStateSchema, EMPTY_DREAM_STATE} from './dream-state-schema.js'

const STATE_FILENAME = 'dream-state.json'

// Module-level mutex registry keyed by absolute state file path.
// The agent process can hold up to AGENT_MAX_CONCURRENT_TASKS concurrent curate tasks
// AND a dream task running concurrently, so read-modify-write on dream-state.json must
// be serialized across all writers — incrementCurationCount, dream-executor's step 7
// reset, and consolidate's pendingMerges clear all share this mutex via update().
// Independent DreamStateService instances pointing at the same file share a mutex.
//
// Note: this Map grows monotonically — one entry per unique absolute state-file
// path ever instantiated. In practice it is bounded by the number of registered
// projects in the agent process (typically single digits), so memory growth is
// negligible. If the daemon ever needs to support project unregister, evict
// entries here on unregister to keep the registry tight.
const stateMutexes = new Map<string, AsyncMutex>()

function getStateMutex(stateFilePath: string): AsyncMutex {
  const key = resolve(stateFilePath)
  let mutex = stateMutexes.get(key)
  if (!mutex) {
    mutex = new AsyncMutex()
    stateMutexes.set(key, mutex)
  }

  return mutex
}

type DreamStateServiceOptions = {
  baseDir: string
}

/**
 * File-based persistence for dream state.
 *
 * Reads return EMPTY_DREAM_STATE on missing/corrupt files (fail-open).
 * Writes are atomic (tmp → rename) and validate with Zod before persisting.
 */
export class DreamStateService {
  private readonly stateFilePath: string

  constructor(opts: DreamStateServiceOptions) {
    this.stateFilePath = join(opts.baseDir, STATE_FILENAME)
  }

  /**
   * Read-modify-write under a per-file mutex. Serializes concurrent increments
   * from parallel curate tasks within the same agent process so no updates are lost.
   */
  async incrementCurationCount(): Promise<void> {
    await this.update((state) => ({...state, curationsSinceDream: state.curationsSinceDream + 1}))
  }

  async read(): Promise<DreamState> {
    try {
      const raw = await readFile(this.stateFilePath, 'utf8')
      const parsed = DreamStateSchema.safeParse(JSON.parse(raw))
      if (!parsed.success) return {...EMPTY_DREAM_STATE, pendingMerges: []}
      return parsed.data
    } catch {
      return {...EMPTY_DREAM_STATE, pendingMerges: []}
    }
  }

  /**
   * Generic read-modify-write under the same per-file mutex used by
   * incrementCurationCount. All writers that mutate dream-state.json based on
   * its current contents (e.g. dream-executor step 7's reset, consolidate's
   * pendingMerges clear) MUST go through this method, otherwise concurrent
   * increments can be silently overwritten.
   */
  async update(updater: (state: DreamState) => DreamState): Promise<DreamState> {
    const mutex = getStateMutex(this.stateFilePath)
    return mutex.withLock(async () => {
      const state = await this.read()
      const next = updater(state)
      await this.write(next)
      return next
    })
  }

  /**
   * Atomic write (tmp file → rename). Does NOT acquire the per-file mutex.
   *
   * Direct callers that perform a logical read-modify-write by pairing
   * {@link read} + write bypass serialization and may lose updates from
   * concurrent writers. Use {@link update} for any RMW that depends on the
   * current state.
   */
  async write(state: DreamState): Promise<void> {
    DreamStateSchema.parse(state)
    const dir = dirname(this.stateFilePath)
    await mkdir(dir, {recursive: true})
    const tmpPath = `${this.stateFilePath}.${randomUUID()}.tmp`
    await writeFile(tmpPath, JSON.stringify(state, null, 2), 'utf8')
    await rename(tmpPath, this.stateFilePath)
  }
}
