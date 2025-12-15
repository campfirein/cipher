import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {homedir} from 'node:os'
import {join} from 'node:path'

import type {IOnboardingPreferenceStore} from '../../core/interfaces/i-onboarding-preference-store.js'

const BRV_HOME_DIR = join(homedir(), '.brv')
const ONBOARDING_LOCK_FILE = join(BRV_HOME_DIR, '.onboarding-dismissed')

/**
 * Onboarding preference store implementation using a lock file.
 * Stores last dismissed timestamp in ~/.brv/.onboarding-dismissed
 */
export class FileOnboardingPreferenceStore implements IOnboardingPreferenceStore {
  public async clear(): Promise<void> {
    try {
      if (existsSync(ONBOARDING_LOCK_FILE)) {
        rmSync(ONBOARDING_LOCK_FILE)
      }
    } catch {
      // Ignore errors
    }
  }

  public async getLastDismissedAt(): Promise<number | undefined> {
    try {
      if (!existsSync(ONBOARDING_LOCK_FILE)) {
        return undefined
      }

      const content = readFileSync(ONBOARDING_LOCK_FILE, 'utf8').trim()
      const timestamp = Number.parseInt(content, 10)
      return Number.isNaN(timestamp) ? undefined : timestamp
    } catch {
      return undefined
    }
  }

  public async setLastDismissedAt(timestamp: number): Promise<void> {
    try {
      // Ensure ~/.brv directory exists
      if (!existsSync(BRV_HOME_DIR)) {
        mkdirSync(BRV_HOME_DIR, {recursive: true})
      }

      writeFileSync(ONBOARDING_LOCK_FILE, String(timestamp), 'utf8')
    } catch {
      // Silently ignore errors - onboarding preference is non-critical
    }
  }
}
