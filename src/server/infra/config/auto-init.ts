import type {IContextTreeService} from '../../core/interfaces/context-tree/i-context-tree-service.js'
import type {IProjectConfigStore} from '../../core/interfaces/storage/i-project-config-store.js'

import {BrvConfig} from '../../core/domain/entities/brv-config.js'
import {syncConfigToXdg} from '../../utils/config-xdg-sync.js'

export interface AutoInitDeps {
  contextTreeService: IContextTreeService
  projectConfigStore: IProjectConfigStore
}

/**
 * Ensures .brv/ is initialized with minimal local config.
 * Creates config and context tree directory if they don't exist.
 * Idempotent: no-op if already initialized.
 *
 * Note: git initialization (.brv/context-tree/.git/) is done explicitly
 * via the /init command, not here.
 */
export async function ensureProjectInitialized(deps: AutoInitDeps, directory?: string): Promise<void> {
  const exists = await deps.projectConfigStore.exists(directory)
  if (exists) return

  const cwd = directory ?? process.cwd()
  const config = BrvConfig.createLocal({cwd})
  await deps.projectConfigStore.write(config, directory)
  await syncConfigToXdg(config, cwd)
  await deps.contextTreeService.initialize(directory)
}
