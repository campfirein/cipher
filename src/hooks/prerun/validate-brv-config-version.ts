import type {Hook} from '@oclif/core'

import type {IProjectConfigStore} from '../../core/interfaces/i-project-config-store.js'

import {BrvConfigVersionError} from '../../core/domain/errors/brv-config-version-error.js'
import {ProjectConfigStore} from '../../infra/config/file-config-store.js'

/**
 * Commands that should skip config version validation.
 * These commands either don't need config or create/recreate it.
 */
export const SKIP_COMMANDS = new Set<string>(['--help', 'help', 'init', 'login', 'logout'])

/**
 * Context for hook error handling.
 */
type HookErrorContext = {
  error: (message: string, options: {exit: number}) => void
}

/**
 * Core validation logic extracted for testability.
 * @param commandId - The command being executed
 * @param configStore - The config store to use for reading config
 * @param errorContext - Context with error function to call on version errors
 */
export const validateBrvConfigVersion = async (
  commandId: string,
  configStore: IProjectConfigStore,
  errorContext: HookErrorContext,
): Promise<void> => {
  // Skip version check for commands that don't need config
  if (SKIP_COMMANDS.has(commandId)) {
    return
  }

  try {
    // If config doesn't exist, let the command handle it
    const exists = await configStore.exists()
    if (!exists) {
      return
    }

    // read() will throw BrvConfigVersionError if version is invalid
    await configStore.read()
  } catch (error) {
    if (error instanceof BrvConfigVersionError) {
      errorContext.error(error.message, {exit: 1})
    }

    // Re-throw other errors (corrupted JSON, etc.)
    throw error
  }
}

/**
 * Prerun hook that validates the .brv/config.json version before command execution.
 * Throws an error if the config version is missing or mismatched, prompting users to re-run `brv init`.
 */
const hook: Hook<'prerun'> = async function (options): Promise<void> {
  await validateBrvConfigVersion(options.Command.id, new ProjectConfigStore(), this)
}

export default hook
