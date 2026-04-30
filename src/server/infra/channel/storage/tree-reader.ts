import {readdir, readFile} from 'node:fs/promises'
import path from 'node:path'

import {ChannelStorageParseError} from '../../../core/domain/channel/errors.js'
import {ChannelMeta, Turn, type TurnState} from '../../../core/domain/channel/types.js'
import {channelDir, turnDir} from './paths.js'

export interface DigestRef {
  coversThrough: string
  createdAt: string
  id: string
  sourceTurnIds: string[]
  summary: string
  version: number
}

export interface TreeReader {
  lastCompletedTurnFor(meta: ChannelMeta, agentId: string): Promise<null | Turn>
  listAllChannels(): Promise<ChannelMeta[]>
  listDigests(meta: ChannelMeta): Promise<DigestRef[]>
  readMeta(channelId: string): Promise<ChannelMeta | null>
  readTurn(meta: ChannelMeta, turnId: string): Promise<null | Turn>
  turnsAfter(meta: ChannelMeta, since: string): Promise<Turn[]>
  turnsInState(meta: ChannelMeta, states: TurnState[]): Promise<Turn[]>
}

export class FileTreeReader implements TreeReader {
  public constructor(private readonly treeRoot: string) {}

  public async lastCompletedTurnFor(meta: ChannelMeta, agentId: string): Promise<null | Turn> {
    const turns = await this.readTurns(meta)
    return turns
      .filter((turn) => turn.agentId === agentId && turn.state === 'completed')
      .sort(compareTurnTimeDesc)[0] ?? null
  }

  public async listAllChannels(): Promise<ChannelMeta[]> {
    const baseDir = path.join(this.treeRoot, '.brv', 'context-tree', 'channel')
    const entries = await readdirSafe(baseDir)
    const metas = await Promise.all(entries.map((entry) => this.readMeta(entry)))
    return metas.filter((meta): meta is ChannelMeta => meta !== null)
  }

  public async listDigests(_meta: ChannelMeta): Promise<DigestRef[]> {
    return []
  }

  public async readMeta(channelId: string): Promise<ChannelMeta | null> {
    const filePath = path.join(this.channelDirForId(channelId), 'meta.json')
    const raw = await readOptionalJson(filePath)
    if (raw === null) return null

    const parsed = ChannelMeta.safeParse(raw)
    if (!parsed.success) {
      throw new ChannelStorageParseError(filePath, parsed.error.message)
    }

    return parsed.data
  }

  public async readTurn(meta: ChannelMeta, turnId: string): Promise<null | Turn> {
    const filePath = path.join(turnDir(meta, turnId), 'turn.json')
    const raw = await readOptionalJson(filePath)
    if (raw === null) return null

    const parsed = Turn.safeParse(raw)
    if (!parsed.success) {
      throw new ChannelStorageParseError(filePath, parsed.error.message)
    }

    return parsed.data
  }

  public async turnsAfter(meta: ChannelMeta, since: string): Promise<Turn[]> {
    const sinceTime = Date.parse(since)
    const turns = await this.readTurns(meta)
    return turns
      .filter((turn) => Date.parse(turn.endedAt ?? turn.startedAt) > sinceTime)
      .sort(compareTurnTimeAsc)
  }

  public async turnsInState(meta: ChannelMeta, states: TurnState[]): Promise<Turn[]> {
    const stateSet = new Set<TurnState>(states)
    const turns = await this.readTurns(meta)
    return turns.filter((turn) => stateSet.has(turn.state))
  }

  private channelDirForId(channelId: string): string {
    return channelDir({channelId, treeRoot: this.treeRoot})
  }

  private async readTurns(meta: ChannelMeta): Promise<Turn[]> {
    const turnsRoot = path.join(channelDir(meta), 'turns')
    const entries = await readdirSafe(turnsRoot)
    const turns = await Promise.all(entries.map((entry) => this.readTurn(meta, entry)))
    return turns.filter((turn): turn is Turn => turn !== null)
  }
}

async function readOptionalJson(filePath: string): Promise<null | unknown> {
  let content: string
  try {
    content = await readFile(filePath, 'utf8')
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return null
    throw error
  }

  try {
    return JSON.parse(content)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid JSON'
    throw new ChannelStorageParseError(filePath, message)
  }
}

async function readdirSafe(dir: string): Promise<string[]> {
  try {
    return await readdir(dir)
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return []
    throw error
  }
}

function compareTurnTimeAsc(a: Turn, b: Turn): number {
  return Date.parse(a.endedAt ?? a.startedAt) - Date.parse(b.endedAt ?? b.startedAt)
}

function compareTurnTimeDesc(a: Turn, b: Turn): number {
  return compareTurnTimeAsc(b, a)
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}
