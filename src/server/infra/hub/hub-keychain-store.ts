import keytar from 'keytar'
import {createCipheriv, createDecipheriv, randomBytes} from 'node:crypto'
import {existsSync} from 'node:fs'
import {chmod, mkdir, readFile, writeFile} from 'node:fs/promises'

import type {IHubKeychainStore} from '../../core/interfaces/hub/i-hub-keychain-store.js'

import {shouldUseFileTokenStore} from '../../utils/environment-detector.js'
import {getGlobalDataDir} from '../../utils/global-data-path.js'

const SERVICE_NAME = 'byterover-cli-hub-registries'
const KEY_FILE = '.hub-registry-keys'
const CREDENTIALS_FILE = 'hub-registry-credentials'
const ALGORITHM = 'aes-256-gcm'
const KEY_LENGTH = 32
const IV_LENGTH = 16

function getAccountName(registryName: string): string {
  return `registry:${registryName}`
}

/**
 * Keychain-based storage for hub registry auth tokens.
 */
class KeychainHubKeychainStore implements IHubKeychainStore {
  async deleteToken(registryName: string): Promise<void> {
    try {
      await keytar.deletePassword(SERVICE_NAME, getAccountName(registryName))
    } catch {
      // Ignore errors
    }
  }

  async getToken(registryName: string): Promise<string | undefined> {
    try {
      const token = await keytar.getPassword(SERVICE_NAME, getAccountName(registryName))
      return token ?? undefined
    } catch {
      return undefined
    }
  }

  async setToken(registryName: string, token: string): Promise<void> {
    try {
      await keytar.setPassword(SERVICE_NAME, getAccountName(registryName), token)
    } catch (error) {
      throw new Error(
        `Failed to save registry token to keychain: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  }
}

/**
 * Dependencies for FileHubKeychainStore. Allows injection for testing.
 */
export interface FileHubKeychainStoreDeps {
  readonly getCredentialsPath: () => string
  readonly getDataDir: () => string
  readonly getKeyPath: () => string
}

const defaultFileDeps: FileHubKeychainStoreDeps = {
  getCredentialsPath: () => `${getGlobalDataDir()}/${CREDENTIALS_FILE}`,
  getDataDir: getGlobalDataDir,
  getKeyPath: () => `${getGlobalDataDir()}/${KEY_FILE}`,
}

/**
 * File-based encrypted storage for hub registry auth tokens.
 * Used on platforms where system keychain is unavailable.
 */
export class FileHubKeychainStore implements IHubKeychainStore {
  private readonly deps: FileHubKeychainStoreDeps

  constructor(deps: FileHubKeychainStoreDeps = defaultFileDeps) {
    this.deps = deps
  }

  async deleteToken(registryName: string): Promise<void> {
    try {
      const tokens = await this.loadAllTokens()
      const updated = Object.fromEntries(Object.entries(tokens).filter(([key]) => key !== registryName))
      await this.saveAllTokens(updated)
    } catch {
      // Ignore errors
    }
  }

  async getToken(registryName: string): Promise<string | undefined> {
    try {
      const tokens = await this.loadAllTokens()
      return tokens[registryName] ?? undefined
    } catch {
      return undefined
    }
  }

  async setToken(registryName: string, token: string): Promise<void> {
    const tokens = await this.loadAllTokens()
    tokens[registryName] = token
    await this.saveAllTokens(tokens)
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

    return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`
  }

  private async loadAllTokens(): Promise<Record<string, string>> {
    const keyPath = this.deps.getKeyPath()
    const credentialsPath = this.deps.getCredentialsPath()

    if (!existsSync(keyPath) || !existsSync(credentialsPath)) {
      return {}
    }

    const key = await readFile(keyPath)
    const encryptedContent = await readFile(credentialsPath, 'utf8')
    const decrypted = this.decrypt(encryptedContent.trim(), key)

    return JSON.parse(decrypted) as Record<string, string>
  }

  private async saveAllTokens(tokens: Record<string, string>): Promise<void> {
    const dataDir = this.deps.getDataDir()
    const keyPath = this.deps.getKeyPath()
    const credentialsPath = this.deps.getCredentialsPath()

    await mkdir(dataDir, {recursive: true})

    const key = randomBytes(KEY_LENGTH)
    await writeFile(keyPath, key)
    await chmod(keyPath, 0o600)

    const plaintext = JSON.stringify(tokens)
    const encrypted = this.encrypt(plaintext, key)

    await writeFile(credentialsPath, encrypted, 'utf8')
    await chmod(credentialsPath, 0o600)
  }
}

/**
 * Creates the appropriate hub keychain store for the current platform.
 */
export function createHubKeychainStore(
  shouldUseFileFn: () => boolean = shouldUseFileTokenStore,
): IHubKeychainStore {
  return shouldUseFileFn() ? new FileHubKeychainStore() : new KeychainHubKeychainStore()
}
