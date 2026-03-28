import {
  ConnectionError,
  ConnectionFailedError,
  type ConnectionResult,
  DaemonSpawnError,
  InstanceCrashedError,
  type ITransportClient,
  NoInstanceRunningError,
  TransportRequestError,
  TransportRequestTimeoutError,
} from '@campfirein/brv-transport-client'

import {TaskErrorCode} from '../../server/core/domain/errors/task-error.js'
import {resolveProject} from '../../server/infra/project/resolve-project.js'
import {createDaemonAwareConnector, type TransportConnector} from '../../server/infra/transport/transport-connector.js'
import {
  getSandboxEnvironmentName,
  isSandboxEnvironment,
  isSandboxNetworkError,
} from '../../server/utils/sandbox-detector.js'

/** Max retry attempts when daemon disconnects mid-task */
const MAX_RETRIES = 3
/** Delay between retry attempts (ms) */
const DEFAULT_RETRY_DELAY_MS = 2000

/** Maps handler error codes to user-friendly CLI messages */
const USER_FRIENDLY_MESSAGES: Record<string, string> = {
  [TaskErrorCode.AGENT_NOT_INITIALIZED]: "Agent failed to initialize. Run 'brv restart' to force a clean restart.",
  [TaskErrorCode.CONTEXT_TREE_NOT_INITIALIZED]: 'Context tree not initialized.',
  [TaskErrorCode.LOCAL_CHANGES_EXIST]: 'You have local changes. Run "brv push" to save your changes before pulling.',
  [TaskErrorCode.NOT_AUTHENTICATED]:
    'Not authenticated. Cloud sync features (push/pull/space) require login — local query and curate work without authentication.',
  [TaskErrorCode.OAUTH_REFRESH_FAILED]:
    'OAuth token refresh failed. Run "brv providers connect <provider> --oauth" to reconnect.',
  [TaskErrorCode.OAUTH_TOKEN_EXPIRED]:
    'OAuth token has expired. Run "brv providers connect <provider> --oauth" to reconnect.',
  [TaskErrorCode.PROJECT_NOT_INIT]: 'Project not initialized. Run "brv restart" to reinitialize.',
  [TaskErrorCode.PROVIDER_NOT_CONFIGURED]:
    'No provider connected. Run "brv providers connect byterover" to use the free built-in provider, or connect another provider.',
  [TaskErrorCode.SPACE_NOT_CONFIGURED]:
    'No space configured. Run "brv space list" to see available spaces, then "brv space switch --team <team> --name <space>" to select one.',
  [TaskErrorCode.SPACE_NOT_FOUND]: 'Space not found. Check your configuration.',
}

export interface DaemonClientOptions {
  /** Max retry attempts. Default: 3 */
  maxRetries?: number
  /** Explicit --project-root flag value to override auto-detection */
  projectRootFlag?: string
  /** Delay between retries in ms. Default: 2000. Set to 0 in tests. */
  retryDelayMs?: number
  /** Optional transport connector for DI/testing */
  transportConnector?: TransportConnector
}

function resolveRequiredProjectPath(projectRootFlag?: string): {projectRoot: string; workspaceRoot: string} {
  const resolution = resolveProject({projectRootFlag})
  if (!resolution) {
    throw new Error('No ByteRover project could be resolved before connecting to the daemon.')
  }

  return resolution
}

/**
 * Connects to the daemon, auto-starting it if needed.
 */
export async function connectToDaemonClient(
  options?: Pick<DaemonClientOptions, 'projectRootFlag' | 'transportConnector'>,
): Promise<ConnectionResult> {
  const connector = options?.transportConnector ?? createDaemonAwareConnector()
  const resolution = resolveRequiredProjectPath(options?.projectRootFlag)
  return connector(undefined, resolution.projectRoot)
}

/**
 * Executes an operation against the daemon with retry logic.
 *
 * Retries on infrastructure failures (daemon spawn timeout, connection dropped,
 * agent disconnected). Does NOT retry on business errors (auth, validation, etc.).
 */
export async function withDaemonRetry<T>(
  fn: (client: ITransportClient, projectRoot?: string, workspaceRoot?: string) => Promise<T>,
  options?: DaemonClientOptions & {
    /** Called before each retry with attempt number (1-indexed) */
    onRetry?: (attempt: number, maxRetries: number) => void
  },
): Promise<T> {
  const maxRetries = options?.maxRetries ?? MAX_RETRIES
  const retryDelayMs = options?.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS
  const connector = options?.transportConnector ?? createDaemonAwareConnector()

  // Pre-resolve project (workspace-link-aware) so the connector registers
  // with the correct projectPath and callers get the resolved workspaceRoot.
  const resolution = resolveRequiredProjectPath(options?.projectRootFlag)
  const resolvedProjectPath = resolution.projectRoot
  const resolvedWorkspaceRoot = resolution.workspaceRoot

  let lastError: unknown

  /* eslint-disable no-await-in-loop -- intentional sequential retry loop */
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let client: ITransportClient | undefined

    try {
      const {client: connectedClient, projectRoot} = await connector(undefined, resolvedProjectPath)
      client = connectedClient

      const value = await fn(client, projectRoot ?? resolvedProjectPath, resolvedWorkspaceRoot)

      await client.disconnect().catch(() => {})
      return value
    } catch (error) {
      if (client) {
        await client.disconnect().catch(() => {})
      }

      lastError = error

      if (isRetryableError(error) && attempt < maxRetries) {
        options?.onRetry?.(attempt + 1, maxRetries)

        await new Promise<void>((resolve) => {
          setTimeout(resolve, retryDelayMs)
        })

        continue
      }

      break
    }
  }
  /* eslint-enable no-await-in-loop */

  throw lastError
}

/**
 * Checks if an error is retryable (daemon/agent infrastructure failure).
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof DaemonSpawnError || error instanceof ConnectionFailedError) return true
  if (error instanceof TransportRequestTimeoutError) return true
  return hasLeakedHandles(error)
}

/**
 * Checks if an error left leaked Socket.IO handles that prevent Node.js from exiting.
 */
export function hasLeakedHandles(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (!('code' in error)) return false
  return error.code === TaskErrorCode.AGENT_DISCONNECTED || error.code === TaskErrorCode.AGENT_NOT_AVAILABLE
}

/**
 * Builds a user-friendly message when provider credentials are missing from storage.
 */
export function providerMissingMessage(activeProvider: string, authMethod?: 'api-key' | 'oauth'): string {
  return authMethod === 'oauth'
    ? `${activeProvider} authentication has expired.\nPlease reconnect: brv providers connect ${activeProvider} --oauth`
    : `${activeProvider} API key is missing from storage.\nPlease reconnect: brv providers connect ${activeProvider} --api-key <your-key>`
}

export interface ProviderErrorContext {
  activeModel?: string
  activeProvider?: string
}

/**
 * Formats a connection error into a user-friendly message.
 */
export function formatConnectionError(error: unknown, providerContext?: ProviderErrorContext): string {
  if (error instanceof NoInstanceRunningError) {
    if (isSandboxEnvironment()) {
      const sandboxName = getSandboxEnvironmentName()
      return (
        `Daemon failed to start automatically.\n` +
        `⚠️  Sandbox environment detected (${sandboxName}).\n\n` +
        `Run 'brv' in a terminal outside the sandbox, then allow network access so this sandbox can connect.`
      )
    }

    return 'Daemon failed to start automatically.\n\nRestart your terminal and retry the command.'
  }

  if (error instanceof InstanceCrashedError) {
    return "Daemon crashed unexpectedly.\n\nRun 'brv restart' to force a clean restart."
  }

  if (error instanceof ConnectionFailedError) {
    const isSandboxError = isSandboxNetworkError(error.originalError ?? error)

    if (isSandboxError) {
      const sandboxName = getSandboxEnvironmentName()
      return (
        `Failed to connect to the daemon.\n` +
        `Port: ${error.port ?? 'unknown'}\n` +
        `⚠️  Sandbox network restriction detected (${sandboxName}).\n\n` +
        `Please allow network access in the sandbox and retry the command.`
      )
    }

    return `Failed to connect to the daemon: ${error.message}\nRun 'brv restart' if the daemon is unresponsive.`
  }

  if (error instanceof ConnectionError) {
    return `Connection error: ${error.message}\nRun 'brv restart' if the daemon is unresponsive.`
  }

  // Business errors from transport handlers (auth, validation, etc.)
  if (error instanceof TransportRequestError) {
    // Strip the " for event '...'" suffix that TransportRequestError appends
    const baseMessage = error.message.replace(/ for event '[^']+'$/, '')

    if (error.code && typeof error.code === 'string') {
      return USER_FRIENDLY_MESSAGES[error.code] ?? baseMessage
    }

    return baseMessage
  }

  const message = error instanceof Error ? error.message : String(error)
  const lowerMessage = message.toLowerCase()

  if (lowerMessage.includes('401') || lowerMessage.includes('unauthorized')) {
    return "Authentication required for cloud sync. Run 'brv login' to connect your account."
  }

  if (lowerMessage.includes('api key') || lowerMessage.includes('invalid key')) {
    const provider = providerContext?.activeProvider ?? '<provider>'
    const model = providerContext?.activeModel
    const currentInfo = model ? `Provider: ${provider}  Model: ${model}\n\n` : `Provider: ${provider}\n\n`

    return (
      `LLM provider credentials are missing or invalid.\n${currentInfo}` +
      '  Reconnect your provider:\n' +
      `    brv providers connect ${provider}\n\n` +
      '  Switch to a different provider:\n' +
      '    brv providers switch <provider>\n\n' +
      '  See all options:  brv providers --help'
    )
  }

  return `Unexpected error: ${message}`
}
