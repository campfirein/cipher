import type {Hook} from '@oclif/core'

import type {IProjectConfigStore} from '../../../server/core/interfaces/storage/i-project-config-store.js'

import {BRV_CONFIG_VERSION} from '../../../server/constants.js'
import {type AutoInitDeps, ensureProjectInitialized} from '../../../server/infra/config/auto-init.js'
import {ProjectConfigStore} from '../../../server/infra/config/file-config-store.js'
import {ensureCurateViewPatched} from '../../../server/infra/connectors/shared/rule-segment-patcher.js'
import {FileContextTreeService} from '../../../server/infra/context-tree/file-context-tree-service.js'
import {FileContextTreeSnapshotService} from '../../../server/infra/context-tree/file-context-tree-snapshot-service.js'

/**
 * Commands that should skip auto-init and config version validation.
 */
export const SKIP_COMMANDS = new Set<string>(['--help', 'help', 'login', 'logout'])

/**
 * Core validation logic extracted for testability.
 * Auto-initializes .brv/ if it doesn't exist, then migrates config version if needed.
 *
 * @param commandId - The command being executed
 * @param configStore - The config store to use for reading config
 * @param autoInitDeps - Dependencies for auto-init (optional, for testing)
 */
export const validateBrvConfigVersion = async (
  commandId: string,
  configStore: IProjectConfigStore,
  autoInitDeps?: AutoInitDeps,
): Promise<void> => {
  // Skip for commands that don't need config
  if (SKIP_COMMANDS.has(commandId)) {
    return
  }

  const exists = await configStore.exists()
  if (!exists) {
    // Auto-init: create .brv/ with minimal local config
    const deps = autoInitDeps ?? {
      contextTreeService: new FileContextTreeService(),
      contextTreeSnapshotService: new FileContextTreeSnapshotService(),
      projectConfigStore: configStore,
    }
    await ensureProjectInitialized(deps)
    return
  }

  // Read existing config — fromJson() preserves original version
  const config = await configStore.read()
  if (config && config.version !== BRV_CONFIG_VERSION) {
    // Migrate: preserve all existing fields, only update version
    await configStore.write(config.withVersion(BRV_CONFIG_VERSION))
  }

  // Auto-patch all connector files on disk to add `brv curate view` segment if missing
  await ensureCurateViewPatched(process.cwd()).catch(() => {})
}

/**
 * Prerun hook that auto-initializes .brv/ if missing, then validates config version.
 */
const hook: Hook<'prerun'> = async function (options): Promise<void> {
  await validateBrvConfigVersion(options.Command.id, new ProjectConfigStore())
}

export default hook
