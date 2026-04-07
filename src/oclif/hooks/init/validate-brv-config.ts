import type {Hook} from '@oclif/core'

import type {IProjectConfigStore} from '../../../server/core/interfaces/storage/i-project-config-store.js'

import {BRV_CONFIG_VERSION} from '../../../server/constants.js'
import {type AutoInitDeps, ensureProjectInitialized} from '../../../server/infra/config/auto-init.js'
import {ProjectConfigStore} from '../../../server/infra/config/file-config-store.js'
import {FileContextTreeService} from '../../../server/infra/context-tree/file-context-tree-service.js'
import {syncConfigToXdg} from '../../../server/utils/config-xdg-sync.js'

/**
 * Commands that should skip auto-init and config version validation.
 */
export const COMMANDS_NEED_AUTO_INIT = new Set<string>(['connectors:install', 'curate', 'hub:install', 'main', 'query'])

const HELP_FLAGS = new Set<string>(['--h', '--help', '-h', '-help'])

/**
 * Core validation logic extracted for testability.
 * Auto-initializes .brv/ if it doesn't exist (for non-vc commands), then migrates config version if needed.
 * VC commands still require explicit `brv vc init`.
 * Also ensures connector files are patched with `brv curate view` docs (once per project).
 *
 * @param commandId - The command being executed
 * @param configStore - The config store to use for reading config
 * @param argv - Command arguments (used to detect help flags)
 * @param autoInitDeps - Dependencies for auto-init (optional, for testing)
 */
export const validateBrvConfigVersion = async (
  commandId: string,
  configStore: IProjectConfigStore,
  argv: string[] = [],
  autoInitDeps?: AutoInitDeps,
): Promise<void> => {
  if (argv.some((arg) => HELP_FLAGS.has(arg))) return

  const exists = await configStore.exists()
  if (!exists && COMMANDS_NEED_AUTO_INIT.has(commandId)) {
    const deps = autoInitDeps ?? {
      contextTreeService: new FileContextTreeService(),
      projectConfigStore: configStore,
    }
    await ensureProjectInitialized(deps)

    const config = await configStore.read()
    if (!config) {
      throw new Error('fatal: corrupt or unreadable config: .brv/config.json')
    }

    // ProjectConfigStore checks .brv/ at process.cwd() directly (no walk-up),
    // so configStore.exists() returning true means process.cwd() IS the project root.
    const cwd = process.cwd()

    if (config.version !== BRV_CONFIG_VERSION) {
      const updated = config.withVersion(BRV_CONFIG_VERSION)
      await configStore.write(updated)
      await syncConfigToXdg(updated, cwd)
    }
  }
}

/**
 * Init hook that ensures .brv/ exists and validates config version.
 * Runs once during CLI bootstrap — does NOT re-fire for runCommand() calls,
 * so commands like `init` can safely delegate to sub-commands.
 */
const hook: Hook<'init'> = async function (options): Promise<void> {
  try {
    await validateBrvConfigVersion(options.id ?? '', new ProjectConfigStore(), options.argv ?? [])
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`${message}\n`)
    // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
    process.exit(1)
  }
}

export default hook
