import {createCipheriv, createDecipheriv, randomBytes} from 'node:crypto'
import {existsSync} from 'node:fs'
import {chmod, mkdir, readFile, writeFile} from 'node:fs/promises'

import type {IProviderKeychainStore} from '../../core/interfaces/i-provider-keychain-store.js'

import {getGlobalDataDir} from '../../utils/global-data-path.js'

const KEY_FILE = '.provider-keys'
const CREDENTIALS_FILE = 'provider-credentials'
const ALGORITHM = 'aes-256-gcm'
const KEY_LENGTH = 32
const IV_LENGTH = 16

/**
 * Dependencies for FileProviderKeychainStore.
 * Allows injection for testing.
 */
export interface FileProviderKeychainStoreDeps {
  readonly getCredentialsPath: () => string
  readonly getDataDir: () => string
  readonly getKeyPath: () => string
}

const defaultDeps: FileProviderKeychainStoreDeps = {
  getCredentialsPath: () => `${getGlobalDataDir()}/${CREDENTIALS_FILE}`,
  getDataDir: getGlobalDataDir,
  getKeyPath: () => `${getGlobalDataDir()}/${KEY_FILE}`,
}

/**
 * File-based encrypted provider keychain store. Used on all platforms.
 *
 * Security:
 * - Random 32-byte key stored in <global-data-dir>/.provider-keys (rotated on each save)
 * - AES-256-GCM authenticated encryption for provider API keys
 * - Both files have 0600 permissions (owner read/write only)
 * - All provider keys stored as encrypted JSON map: { [providerId]: apiKey }
 */
export class FileProviderKeychainStore implements IProviderKeychainStore {
  private readonly deps: FileProviderKeychainStoreDeps

  public constructor(deps: FileProviderKeychainStoreDeps = defaultDeps) {
    this.deps = deps
  }

  public async deleteApiKey(providerId: string): Promise<void> {
    try {
      const keys = await this.loadAllKeys()
      const updated = Object.fromEntries(Object.entries(keys).filter(([key]) => key !== providerId))
      await this.saveAllKeys(updated)
    } catch {
      // Ignore errors (key may not exist, permissions, etc.)
    }
  }

  public async getApiKey(providerId: string): Promise<string | undefined> {
    try {
      const keys = await this.loadAllKeys()

      return keys[providerId] ?? undefined
    } catch {
      return undefined
    }
  }

  public async hasApiKey(providerId: string): Promise<boolean> {
    const apiKey = await this.getApiKey(providerId)

    return apiKey !== undefined
  }

  public async setApiKey(providerId: string, apiKey: string): Promise<void> {
    const keys = await this.loadAllKeys()
    keys[providerId] = apiKey
    await this.saveAllKeys(keys)
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

  private async loadAllKeys(): Promise<Record<string, string>> {
    const keyPath = this.deps.getKeyPath()
    const credentialsPath = this.deps.getCredentialsPath()

    if (!existsSync(keyPath) || !existsSync(credentialsPath)) {
      return {}
    }

    const key = await readFile(keyPath)
    const encrypted = await readFile(credentialsPath, 'utf8')
    const decrypted = this.decrypt(encrypted.trim(), key)

    return JSON.parse(decrypted) as Record<string, string>
  }

  private async saveAllKeys(keys: Record<string, string>): Promise<void> {
    const dataDir = this.deps.getDataDir()
    const keyPath = this.deps.getKeyPath()
    const credentialsPath = this.deps.getCredentialsPath()

    await mkdir(dataDir, {recursive: true})

    // Always generate new key for rotation (security best practice)
    const key = randomBytes(KEY_LENGTH)
    await writeFile(keyPath, key)
    await chmod(keyPath, 0o600)

    const plaintext = JSON.stringify(keys)
    const encrypted = this.encrypt(plaintext, key)

    await writeFile(credentialsPath, encrypted, 'utf8')
    await chmod(credentialsPath, 0o600)
  }
}
