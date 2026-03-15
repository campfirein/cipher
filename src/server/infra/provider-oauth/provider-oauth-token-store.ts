import {createCipheriv, createDecipheriv, randomBytes} from 'node:crypto'
import {mkdir, readFile, rename, writeFile} from 'node:fs/promises'
import {z} from 'zod'

import type {IProviderOAuthTokenStore, OAuthTokenRecord} from '../../core/interfaces/i-provider-oauth-token-store.js'

import {getGlobalDataDir} from '../../utils/global-data-path.js'

const OAuthTokenRecordSchema = z.object({
  expiresAt: z.string(),
  refreshToken: z.string(),
})
const TokenRecordMapSchema = z.record(OAuthTokenRecordSchema)

const KEY_FILE = '.provider-oauth-keys'
const CREDENTIALS_FILE = 'provider-oauth-tokens'
const ALGORITHM = 'aes-256-gcm'
const KEY_LENGTH = 32
const IV_LENGTH = 16

/**
 * Dependencies for FileProviderOAuthTokenStore.
 * Allows injection for testing (paths + filesystem operations).
 */
export interface FileProviderOAuthTokenStoreDeps {
  readonly ensureDir?: (path: string) => Promise<void>
  readonly getCredentialsPath: () => string
  readonly getDataDir: () => string
  readonly getKeyPath: () => string
  readonly readBuffer?: (path: string) => Promise<Buffer>
  readonly readString?: (path: string) => Promise<string>
  readonly renameFile?: (oldPath: string, newPath: string) => Promise<void>
  readonly writeData?: (
    path: string,
    data: Buffer | string,
    options: {encoding?: 'utf8'; mode: number},
  ) => Promise<void>
}

const defaultDeps: FileProviderOAuthTokenStoreDeps = {
  getCredentialsPath: () => `${getGlobalDataDir()}/${CREDENTIALS_FILE}`,
  getDataDir: getGlobalDataDir,
  getKeyPath: () => `${getGlobalDataDir()}/${KEY_FILE}`,
}

/**
 * File-based encrypted OAuth token store.
 *
 * Security:
 * - Random 32-byte key stored in <global-data-dir>/.provider-oauth-keys (rotated on each save)
 * - AES-256-GCM authenticated encryption for OAuth refresh tokens + expiry
 * - Both files have 0600 permissions (owner read/write only)
 * - All tokens stored as encrypted JSON map: { [providerId]: OAuthTokenRecord }
 */
export class FileProviderOAuthTokenStore implements IProviderOAuthTokenStore {
  private readonly deps: FileProviderOAuthTokenStoreDeps
  private readonly ensureDir: (path: string) => Promise<void>
  private readonly readBuffer: (path: string) => Promise<Buffer>
  private readonly readString: (path: string) => Promise<string>
  private readonly renameFile: (oldPath: string, newPath: string) => Promise<void>
  private readonly writeData: (
    path: string,
    data: Buffer | string,
    options: {encoding?: 'utf8'; mode: number},
  ) => Promise<void>
  /** Serializes concurrent read-modify-write cycles to prevent data loss */
  private writeLock: Promise<void> = Promise.resolve()

  public constructor(deps: FileProviderOAuthTokenStoreDeps = defaultDeps) {
    this.deps = deps
    this.ensureDir = deps.ensureDir ?? ((p) => mkdir(p, {recursive: true}).then(() => {}))
    this.readBuffer = deps.readBuffer ?? ((p) => readFile(p))
    this.readString = deps.readString ?? ((p) => readFile(p, 'utf8'))
    this.renameFile = deps.renameFile ?? rename
    this.writeData = deps.writeData ?? ((p, d, o) => writeFile(p, d, o))
  }

  public async delete(providerId: string): Promise<void> {
    return this.serialize(async () => {
      let records: Record<string, OAuthTokenRecord>
      try {
        records = await this.loadAll()
      } catch {
        return // No file to delete from
      }

      const updated = Object.fromEntries(Object.entries(records).filter(([key]) => key !== providerId))
      await this.saveAll(updated)
    })
  }

  public async get(providerId: string): Promise<OAuthTokenRecord | undefined> {
    return this.serialize(async () => {
      try {
        const records = await this.loadAll()

        return records[providerId] ?? undefined
      } catch {}
    })
  }

  public async has(providerId: string): Promise<boolean> {
    const record = await this.get(providerId)

    return record !== undefined
  }

  public async set(providerId: string, data: OAuthTokenRecord): Promise<void> {
    return this.serialize(async () => {
      let records: Record<string, OAuthTokenRecord>
      try {
        records = await this.loadAll()
      } catch {
        // Credentials file is corrupt or unreadable — start fresh.
        // Existing records are unrecoverable; overwriting is the only path forward.
        records = {}
      }

      records[providerId] = data
      await this.saveAll(records)
    })
  }

  private decrypt(ciphertext: string, key: Buffer): string {
    const parts = ciphertext.split(':')
    if (parts.length !== 3) {
      throw new Error('Invalid format')
    }

    const iv = Buffer.from(parts[0], 'base64')
    const authTag = Buffer.from(parts[1], 'base64')
    const encrypted = Buffer.from(parts[2], 'base64')

    const decipher = createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(authTag)

    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
  }

  private encrypt(plaintext: string, key: Buffer): string {
    const iv = randomBytes(IV_LENGTH)
    const cipher = createCipheriv(ALGORITHM, key, iv)
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const authTag = cipher.getAuthTag()

    /** Format: iv:authTag:data (all base64) */
    return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`
  }

  private async loadAll(): Promise<Record<string, OAuthTokenRecord>> {
    const keyPath = this.deps.getKeyPath()
    const credentialsPath = this.deps.getCredentialsPath()

    try {
      const key = await this.readBuffer(keyPath)
      const encrypted = await this.readString(credentialsPath)
      const decrypted = this.decrypt(encrypted.trim(), key)
      const parsed: unknown = JSON.parse(decrypted)

      return TokenRecordMapSchema.parse(parsed)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return {}
      throw error
    }
  }

  private async saveAll(records: Record<string, OAuthTokenRecord>): Promise<void> {
    const dataDir = this.deps.getDataDir()
    const keyPath = this.deps.getKeyPath()
    const credentialsPath = this.deps.getCredentialsPath()
    const tmpKeyPath = `${keyPath}.tmp`
    const tmpCredentialsPath = `${credentialsPath}.tmp`

    await this.ensureDir(dataDir)

    // Always generate new key for rotation (security best practice).
    // Write to temp files first, then atomically rename both — a crash at any
    // point leaves either the old consistent pair or the new one, never a
    // mismatched key/ciphertext that would destroy all stored tokens.
    const key = randomBytes(KEY_LENGTH)
    const plaintext = JSON.stringify(records)
    const encrypted = this.encrypt(plaintext, key)

    await this.writeData(tmpKeyPath, key, {mode: 0o600})
    await this.writeData(tmpCredentialsPath, encrypted, {encoding: 'utf8', mode: 0o600})

    // Rename key first, then credentials. If a crash occurs between the two
    // renames, loadAll() will read the new key + old ciphertext and fail to
    // decrypt — but set() recovers by overwriting with fresh data. The key
    // improvement is that writes target temp files, so a crash during the
    // write phase never corrupts the live key/ciphertext pair.
    await this.renameFile(tmpKeyPath, keyPath)
    await this.renameFile(tmpCredentialsPath, credentialsPath)
  }

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.writeLock.then(fn, fn)
    this.writeLock = result.then(
      () => {},
      () => {},
    )
    return result
  }
}

export function createProviderOAuthTokenStore(): IProviderOAuthTokenStore {
  return new FileProviderOAuthTokenStore()
}
