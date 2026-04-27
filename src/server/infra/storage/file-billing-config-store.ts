import {existsSync} from 'node:fs'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import type {IBillingConfigStore} from '../../core/interfaces/storage/i-billing-config-store.js'

import {getGlobalConfigDir} from '../../utils/global-config-path.js'

export interface FileBillingConfigStoreDeps {
  readonly getConfigDir: () => string
  readonly getConfigPath: () => string
}

const BILLING_CONFIG_FILE = 'billing.json'

const defaultDeps: FileBillingConfigStoreDeps = {
  getConfigDir: getGlobalConfigDir,
  getConfigPath: () => join(getGlobalConfigDir(), BILLING_CONFIG_FILE),
}

interface BillingConfigJson {
  pinnedOrganizationId?: string
}

/**
 * File-backed persistence for the user's billing preferences. Stored alongside
 * the global config (~/.config/brv on Linux, ~/Library/Application Support/brv
 * on macOS, %APPDATA%\brv on Windows) so the pin survives across workspaces
 * and daemon restarts.
 */
export class FileBillingConfigStore implements IBillingConfigStore {
  private readonly deps: FileBillingConfigStoreDeps

  public constructor(deps: FileBillingConfigStoreDeps = defaultDeps) {
    this.deps = deps
  }

  public async getPinnedOrganizationId(): Promise<string | undefined> {
    const json = await this.readJson()
    return json.pinnedOrganizationId
  }

  public async setPinnedOrganizationId(organizationId: string | undefined): Promise<void> {
    const next: BillingConfigJson = {}
    if (organizationId !== undefined) next.pinnedOrganizationId = organizationId

    await mkdir(this.deps.getConfigDir(), {recursive: true})
    await writeFile(this.deps.getConfigPath(), JSON.stringify(next, null, 2), 'utf8')
  }

  private async readJson(): Promise<BillingConfigJson> {
    const path = this.deps.getConfigPath()
    if (!existsSync(path)) return {}

    try {
      const content = await readFile(path, 'utf8')
      const parsed: unknown = JSON.parse(content)
      if (parsed && typeof parsed === 'object' && 'pinnedOrganizationId' in parsed) {
        const value = (parsed as {pinnedOrganizationId?: unknown}).pinnedOrganizationId
        if (typeof value === 'string') return {pinnedOrganizationId: value}
      }

      return {}
    } catch {
      // Corrupted file or read error — caller treats as "no pin".
      return {}
    }
  }
}
