import {createCipheriv, createDecipheriv, randomBytes} from 'node:crypto'
import {existsSync} from 'node:fs'
import {chmod, mkdir, readFile, unlink, writeFile} from 'node:fs/promises'

import type {ITokenStore} from '../../core/interfaces/auth/i-token-store.js'

import {AuthToken} from '../../core/domain/entities/auth-token.js'
import {getGlobalDataDir} from '../../utils/global-data-path.js'

const KEY_FILE = '.token-key'
const CREDENTIALS_FILE = 'credentials'
const ALGORITHM = 'aes-256-gcm'
const KEY_LENGTH = 32
const IV_LENGTH = 16

/**
 * Dependencies for FileTokenStore.
 * Allows injection for testing.
 */
export interface FileTokenStoreDeps {
  readonly getCredentialsPath: () => string
  readonly getDataDir: () => string
  readonly getKeyPath: () => string
}

const defaultDeps: FileTokenStoreDeps = {
  getCredentialsPath: () => `${getGlobalDataDir()}/${CREDENTIALS_FILE}`,
  getDataDir: getGlobalDataDir,
  getKeyPath: () => `${getGlobalDataDir()}/${KEY_FILE}`,
}

/**
 * File-based token store for WSL2 environments.
 *
 * Note: This class should not be used directly. Use createTokenStore() instead,
 * which handles platform detection and selects the appropriate backend.
 *
 * Security:
 * - Random 32-byte key stored in <global-data-dir>/.token-key (rotated on each save)
 * - AES-256-GCM authenticated encryption for token data
 * - Both files have 0600 permissions (owner read/write only)
 */
export class FileTokenStore implements ITokenStore {
  private readonly deps: FileTokenStoreDeps

  public constructor(deps: FileTokenStoreDeps = defaultDeps) {
    this.deps = deps
  }

  public async clear(): Promise<void> {
    try {
      const credentialsPath = this.deps.getCredentialsPath()
      const keyPath = this.deps.getKeyPath()

      if (existsSync(credentialsPath)) {
        await unlink(credentialsPath)
      }

      if (existsSync(keyPath)) {
        await unlink(keyPath)
      }
    } catch {
      /** Ignore errors */
    }
  }

  public async load(): Promise<AuthToken | undefined> {
    try {
      const keyPath = this.deps.getKeyPath()
      const credentialsPath = this.deps.getCredentialsPath()

      if (!existsSync(keyPath) || !existsSync(credentialsPath)) {
        return undefined
      }

      const key = await readFile(keyPath)
      const encrypted = await readFile(credentialsPath, 'utf8')
      const decrypted = this.decrypt(encrypted.trim(), key)
      const json = JSON.parse(decrypted)

      return AuthToken.fromJson(json)
    } catch {
      return undefined
    }
  }

  public async save(token: AuthToken): Promise<void> {
    const dataDir = this.deps.getDataDir()
    const keyPath = this.deps.getKeyPath()
    const credentialsPath = this.deps.getCredentialsPath()

    await mkdir(dataDir, {recursive: true})

    // Always generate new key for rotation (security best practice)
    const key = randomBytes(KEY_LENGTH)
    await writeFile(keyPath, key)
    await chmod(keyPath, 0o600)

    const plaintext = JSON.stringify(token.toJson())
    const encrypted = this.encrypt(plaintext, key)

    await writeFile(credentialsPath, encrypted, 'utf8')
    await chmod(credentialsPath, 0o600)
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
}
