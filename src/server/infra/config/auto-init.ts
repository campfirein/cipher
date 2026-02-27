import type {IContextTreeService} from '../../core/interfaces/context-tree/i-context-tree-service.js'
import type {IContextTreeSnapshotService} from '../../core/interfaces/context-tree/i-context-tree-snapshot-service.js'
import type {IProjectConfigStore} from '../../core/interfaces/storage/i-project-config-store.js'

import {BrvConfig} from '../../core/domain/entities/brv-config.js'
import {syncConfigToXdg} from '../../utils/config-xdg-sync.js'

export interface AutoInitDeps {
  contextTreeService: IContextTreeService
  contextTreeSnapshotService: IContextTreeSnapshotService
  projectConfigStore: IProjectConfigStore
}

/**
 * Ensures .brv/ is initialized with minimal local config.
 * Creates config, context tree directory, and empty snapshot if they don't exist.
 * Idempotent: no-op if already initialized.
 */
export async function ensureProjectInitialized(deps: AutoInitDeps, directory?: string): Promise<void> {
  const exists = await deps.projectConfigStore.exists(directory)
  if (exists) return

  const cwd = directory ?? process.cwd()
  const config = BrvConfig.createLocal({cwd})
  await deps.projectConfigStore.write(config, directory)
  await syncConfigToXdg(config, cwd)
  await deps.contextTreeService.initialize(directory)
  await deps.contextTreeSnapshotService.initEmptySnapshot(directory)
}
