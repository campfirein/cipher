import {appendFile, mkdir, rename, writeFile} from 'node:fs/promises'
import path from 'node:path'

import type {ChannelMeta, Turn, TurnEvent} from '../../../core/domain/channel/types.js'

import {artifactDir, channelDir, turnDir} from './paths.js'

export interface TreeWriter {
  appendArtifact(meta: ChannelMeta, relPath: string, content: Buffer): Promise<{bytes: number; path: string}>
  ensureChannelDir(meta: ChannelMeta): Promise<void>
  reserveTurnIds(meta: ChannelMeta, count: number): Promise<string[]>
  writeMeta(meta: ChannelMeta): Promise<void>
  writeTurn(meta: ChannelMeta, turn: Turn, message: string, events: TurnEvent[]): Promise<void>
  writeTurnInitial(meta: ChannelMeta, turn: Turn): Promise<void>
}

const reservationLocks = new Map<string, Promise<void>>()

export class FileTreeWriter implements TreeWriter {
  public async appendArtifact(meta: ChannelMeta, relPath: string, content: Buffer): Promise<{bytes: number; path: string}> {
    const filePath = path.join(artifactDir(meta), relPath)
    await mkdir(path.dirname(filePath), {recursive: true})
    await appendFile(filePath, content)

    return {
      bytes: content.byteLength,
      path: relPath,
    }
  }

  public async ensureChannelDir(meta: ChannelMeta): Promise<void> {
    await mkdir(channelDir(meta), {recursive: true})
  }

  public async reserveTurnIds(meta: ChannelMeta, count: number): Promise<string[]> {
    const key = channelDir(meta)
    const previous = reservationLocks.get(key) ?? Promise.resolve()
    let release: (() => void) | undefined
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const chained = previous.then(() => current)
    reservationLocks.set(key, chained)

    await previous
    try {
      const start = meta.turnCount + 1
      const ids = Array.from({length: count}, (_value, index) => formatTurnId(start + index))
      meta.turnCount += count
      await this.writeMeta(meta)
      return ids
    } finally {
      if (release !== undefined) release()
      if (reservationLocks.get(key) === chained) {
        reservationLocks.delete(key)
      }
    }
  }

  public async writeMeta(meta: ChannelMeta): Promise<void> {
    await this.ensureChannelDir(meta)
    await writeJsonAtomic(path.join(channelDir(meta), 'meta.json'), meta)
  }

  public async writeTurn(meta: ChannelMeta, turn: Turn, message: string, events: TurnEvent[]): Promise<void> {
    const dir = turnDir(meta, turn.turnId)
    await mkdir(dir, {recursive: true})
    await Promise.all([
      writeJsonAtomic(path.join(dir, 'turn.json'), turn),
      writeFileAtomic(path.join(dir, 'message.md'), message),
      writeFileAtomic(path.join(dir, 'events.jsonl'), events.map((event) => JSON.stringify(event)).join('\n') + (events.length > 0 ? '\n' : '')),
    ])
  }

  public async writeTurnInitial(meta: ChannelMeta, turn: Turn): Promise<void> {
    await this.writeTurn(meta, turn, '', [])
  }
}

function formatTurnId(value: number): string {
  return `t-${String(value).padStart(3, '0')}`
}

async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  await writeFileAtomic(filePath, `${JSON.stringify(data, null, 2)}\n`)
}

async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), {recursive: true})
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmpPath, content, 'utf8')
  await rename(tmpPath, filePath)
}
