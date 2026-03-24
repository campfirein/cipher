/**
 * Pre-task Provider Validation
 *
 * Pure validation logic extracted from agent-process.ts for testability.
 * Checks that the provider config is ready for task execution.
 */

import type {TaskErrorData} from '../../core/domain/errors/task-error.js'
import type {ProviderConfigResponse} from '../../core/domain/transport/schemas.js'

import {TaskErrorCode} from '../../core/domain/errors/task-error.js'

/**
 * Validate provider config before executing a task.
 * Returns a TaskErrorData if validation fails, undefined if all checks pass.
 *
 * Check order matters — most fundamental issues first:
 * 1. No provider connected
 * 2. Provider credential missing (API key or expired OAuth token)
 * 3. Provider requires authentication (ByteRover auth gate)
 */
export const validateProviderForTask = (config: ProviderConfigResponse): TaskErrorData | undefined => {
  if (!config.activeProvider) {
    return {
      code: TaskErrorCode.PROVIDER_NOT_CONFIGURED,
      message: 'No provider connected. Use /provider in the REPL to configure a provider.',
      name: 'TaskError',
    }
  }

  if (config.providerKeyMissing) {
    const modelInfo = config.activeModel ? ` (model: ${config.activeModel})` : ''
    const credentialType = config.authMethod === 'oauth' ? 'authentication has expired' : 'API key is missing'
    return {
      code: TaskErrorCode.PROVIDER_NOT_CONFIGURED,
      message: `${config.activeProvider} ${credentialType}${modelInfo}. Use /provider in the REPL to reconnect.`,
      name: 'TaskError',
    }
  }

  if (config.loginRequired) {
    return {
      code: TaskErrorCode.PROVIDER_NOT_CONFIGURED,
      message: 'Provider requires authentication. Run /login or brv login to sign in.',
      name: 'TaskError',
    }
  }

  return undefined
}
