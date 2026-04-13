import {randomUUID} from 'node:crypto'
import {mkdir, readFile, rename, writeFile} from 'node:fs/promises'
import {dirname, join} from 'node:path'

import {type DreamState, DreamStateSchema, EMPTY_DREAM_STATE} from './dream-state-schema.js'

const STATE_FILENAME = 'dream-state.json'

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
   * Atomic read-modify-write. Safe under the single-writer assumption
   * (project task queue is sequential, max concurrency = 1 per project).
   */
  async incrementCurationCount(): Promise<void> {
    const state = await this.read()
    state.curationsSinceDream++
    await this.write(state)
  }

  async read(): Promise<DreamState> {
    try {
      const raw = await readFile(this.stateFilePath, 'utf8')
      const parsed = DreamStateSchema.safeParse(JSON.parse(raw))
      if (!parsed.success) return {...EMPTY_DREAM_STATE}
      return parsed.data
    } catch {
      return {...EMPTY_DREAM_STATE}
    }
  }

  async write(state: DreamState): Promise<void> {
    DreamStateSchema.parse(state)
    const dir = dirname(this.stateFilePath)
    await mkdir(dir, {recursive: true})
    const tmpPath = `${this.stateFilePath}.${randomUUID()}.tmp`
    await writeFile(tmpPath, JSON.stringify(state, null, 2), 'utf8')
    await rename(tmpPath, this.stateFilePath)
  }
}
