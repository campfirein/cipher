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
  [TaskErrorCode.CONTEXT_TREE_NOT_INITIALIZED]: 'Context tree not initialized. Run "brv init" first.',
  [TaskErrorCode.LOCAL_CHANGES_EXIST]:
    'You have local changes. Run "brv push" to save or "brv reset" to discard first.',
  [TaskErrorCode.NOT_AUTHENTICATED]: 'Not authenticated. Run "brv login" first.',
  [TaskErrorCode.PROJECT_NOT_INIT]: 'Project not initialized. Run "brv init" first.',
  [TaskErrorCode.PROVIDER_NOT_CONFIGURED]: 'No provider connected. Run "brv providers connect <provider>" to configure a provider.',
  [TaskErrorCode.SPACE_NOT_CONFIGURED]: 'No space configured. Run "brv space switch" to select a space first.',
  [TaskErrorCode.SPACE_NOT_FOUND]: 'Space not found. Check your configuration.',
}

export interface DaemonClientOptions {
  /** Max retry attempts. Default: 3 */
  maxRetries?: number
  /** Delay between retries in ms. Default: 2000. Set to 0 in tests. */
  retryDelayMs?: number
  /** Optional transport connector for DI/testing */
  transportConnector?: TransportConnector
}

/**
 * Connects to the daemon, auto-starting it if needed.
 */
export async function connectToDaemonClient(
  options?: Pick<DaemonClientOptions, 'transportConnector'>,
): Promise<ConnectionResult> {
  const connector = options?.transportConnector ?? createDaemonAwareConnector()
  return connector()
}

/**
 * Executes an operation against the daemon with retry logic.
 *
 * Retries on infrastructure failures (daemon spawn timeout, connection dropped,
 * agent disconnected). Does NOT retry on business errors (auth, validation, etc.).
 */
export async function withDaemonRetry<T>(
  fn: (client: ITransportClient, projectRoot?: string) => Promise<T>,
  options?: DaemonClientOptions & {
    /** Called before each retry with attempt number (1-indexed) */
    onRetry?: (attempt: number, maxRetries: number) => void
  },
): Promise<T> {
  const maxRetries = options?.maxRetries ?? MAX_RETRIES
  const retryDelayMs = options?.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS
  const connector = options?.transportConnector ?? createDaemonAwareConnector()

  let lastError: unknown

  /* eslint-disable no-await-in-loop -- intentional sequential retry loop */
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let client: ITransportClient | undefined

    try {
      const {client: connectedClient, projectRoot} = await connector()
      client = connectedClient

      const value = await fn(client, projectRoot)

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
 * Formats a connection error into a user-friendly message.
 */
export function formatConnectionError(error: unknown): string {
  if (error instanceof NoInstanceRunningError) {
    if (isSandboxEnvironment()) {
      const sandboxName = getSandboxEnvironmentName()
      return (
        `No ByteRover instance is running.\n` +
        `⚠️  Sandbox environment detected (${sandboxName}).\n\n` +
        `Please run 'brv' command in a separate terminal window/tab outside the sandbox first.`
      )
    }

    return (
      'No ByteRover instance is running.\n\n' +
      'Start a ByteRover instance by running "brv" in a separate terminal window/tab.\n' +
      'The instance will keep running and handle your commands.'
    )
  }

  if (error instanceof InstanceCrashedError) {
    return "ByteRover instance has crashed.\n\nRun 'brv restart' to force a clean restart."
  }

  if (error instanceof ConnectionFailedError) {
    const isSandboxError = isSandboxNetworkError(error.originalError ?? error)

    if (isSandboxError) {
      const sandboxName = getSandboxEnvironmentName()
      return (
        `Failed to connect to ByteRover instance.\n` +
        `Port: ${error.port ?? 'unknown'}\n` +
        `⚠️  Sandbox network restriction detected (${sandboxName}).\n\n` +
        `Please allow network access in the sandbox and retry the command.`
      )
    }

    return `Failed to connect to ByteRover instance: ${error.message}\nRun 'brv restart' if the daemon is unresponsive.`
  }

  if (error instanceof ConnectionError) {
    return `Connection error: ${error.message}\nRun 'brv restart' if the daemon is unresponsive.`
  }

  // Business errors from transport handlers (auth, validation, etc.)
  if (error instanceof TransportRequestError) {
    if ('code' in error && typeof error.code === 'string') {
      return USER_FRIENDLY_MESSAGES[error.code] ?? error.message
    }

    return error.message
  }

  const message = error instanceof Error ? error.message : String(error)
  const lowerMessage = message.toLowerCase()

  if (lowerMessage.includes('401') || lowerMessage.includes('unauthorized')) {
    return "Authentication required. Run 'brv login' to authenticate."
  }

  if (lowerMessage.includes('api key') || lowerMessage.includes('invalid key')) {
    return "LLM provider API key is missing or invalid. Run 'brv providers' to configure."
  }

  return `Unexpected error: ${message}`
}
