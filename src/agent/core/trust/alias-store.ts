import {existsSync} from 'node:fs'
import {chmod, mkdir, readFile, rename, writeFile} from 'node:fs/promises'
import {dirname} from 'node:path'

import {isValidPeerIdString} from './peer-id.js'
import {withProcessLock} from './process-lock.js'

/**
 * Phase 9 / Slice 9.5 — local alias store.
 *
 * Maps a short human-friendly name (e.g. `alice`) to a libp2p
 * `peer_id`. Backing file: `<storeDir>/aliases.json`, mode 0600
 * (operator-private). Cross-process flock via `process-lock.ts`.
 *
 * The store is intentionally narrow:
 *   - aliases are local-only (NOT shared / published)
 *   - the file holds ONLY `{alias, peerId}` pairs — no metadata,
 *     no timestamps, no display names. Operators can re-derive
 *     those from the TOFU store via `peer_id`
 *   - on-disk form is sorted by alias so the file diffs cleanly
 *     when committed to a personal dotfile repo
 *
 * Invariants:
 *   - alias names are trimmed and non-empty
 *   - `peer_id` MUST pass `isValidPeerIdString` at write time
 *   - lookups trim whitespace from the input
 */

const LOCK_SUFFIX = '.lock'

export type AliasEntry = {
  readonly alias: string
  readonly peerId: string
}

export interface AliasStoreDeps {
  readonly storePath: string
}

interface AliasFileShape {
  entries: AliasEntry[]
}

const NOOP = (): void => {}

const inProcessLocks = new Map<string, Promise<void>>()

export class AliasStore {
  private readonly lockPath: string
  private readonly storePath: string

  public constructor(deps: AliasStoreDeps) {
    this.storePath = deps.storePath
    this.lockPath = `${deps.storePath}${LOCK_SUFFIX}`
  }

  /** Reverse lookup — return the alias mapped to a peer_id, or undefined. */
  public async findAliasForPeerId(peerId: string): Promise<string | undefined> {
    const entries = await this.list()
    return entries.find((e) => e.peerId === peerId)?.alias
  }

  /** Resolve an alias to its peer_id, or undefined when unknown. */
  public async get(alias: string): Promise<string | undefined> {
    const trimmed = alias.trim()
    const entries = await this.list()
    return entries.find((e) => e.alias === trimmed)?.peerId
  }

  /** Return every alias entry sorted by alias name. */
  public async list(): Promise<AliasEntry[]> {
    if (!existsSync(this.storePath)) return []
    const raw = await readFile(this.storePath, 'utf8')
    if (raw.trim() === '') return []
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      // Corrupt JSON — treat as empty so a broken file doesn't wedge
      // the CLI; the next `set` will rewrite cleanly.
      return []
    }

    if (typeof parsed !== 'object' || parsed === null) return []
    const {entries} = (parsed as {entries?: unknown})
    if (!Array.isArray(entries)) return []
    return entries
      .filter(
        (e): e is AliasEntry =>
          typeof e === 'object' && e !== null && typeof e.alias === 'string' && typeof e.peerId === 'string',
      )
      .sort((a, b) => a.alias.localeCompare(b.alias))
  }

  /** Remove an alias. Idempotent. */
  public async remove(alias: string): Promise<void> {
    const trimmed = alias.trim()
    if (trimmed === '') return
    return this.runExclusive(async () => {
      const entries = await this.list()
      const next = entries.filter((e) => e.alias !== trimmed)
      if (next.length === entries.length) return
      await this.writeAtomic(next)
    })
  }

  /**
   * Upsert an alias → peer_id mapping. Throws on empty alias or
   * malformed peer_id.
   */
  public async set(alias: string, peerId: string): Promise<void> {
    const trimmed = alias.trim()
    if (trimmed === '') {
      throw new Error('ALIAS_NAME_EMPTY: alias must be non-empty after trimming whitespace')
    }

    if (!isValidPeerIdString(peerId)) {
      throw new Error(`ALIAS_PEER_ID_INVALID: "${peerId}" is not a valid Ed25519 libp2p peer_id`)
    }

    return this.runExclusive(async () => {
      const entries = await this.list()
      const filtered = entries.filter((e) => e.alias !== trimmed)
      filtered.push({alias: trimmed, peerId})
      filtered.sort((a, b) => a.alias.localeCompare(b.alias))
      await this.writeAtomic(filtered)
    })
  }

  private async runExclusive<T>(body: () => Promise<T>): Promise<T> {
    const previous = inProcessLocks.get(this.storePath) ?? Promise.resolve()
    let resolveSelf: () => void = NOOP
    const current = new Promise<void>((r) => {
      resolveSelf = r
    })
    inProcessLocks.set(this.storePath, current)
    try {
      await previous
      await mkdir(dirname(this.storePath), {mode: 0o700, recursive: true})
      return await withProcessLock(this.lockPath, body)
    } finally {
      resolveSelf()
      if (inProcessLocks.get(this.storePath) === current) {
        inProcessLocks.delete(this.storePath)
      }
    }
  }

  private async writeAtomic(entries: AliasEntry[]): Promise<void> {
    const payload: AliasFileShape = {entries}
    const tmp = `${this.storePath}.tmp`
    await writeFile(tmp, `${JSON.stringify(payload, undefined, 2)}\n`, {encoding: 'utf8'})
    await chmod(tmp, 0o600)
    await rename(tmp, this.storePath)
  }
}
