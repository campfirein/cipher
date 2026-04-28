type TaskError = {
  code?: string
  message: string
  name?: string
}

type Input = {
  error: TaskError | undefined
  /** True if an `llmservice:error` broadcast landed for this task (tracked in the task store). */
  hadLlmServiceError: boolean
}

/**
 * Task error codes the daemon emits directly for provider-config issues.
 */
const PROVIDER_CODES = new Set([
  'ERR_LLM_ERROR',
  'ERR_LLM_RATE_LIMIT',
  'ERR_OAUTH_REFRESH_FAILED',
  'ERR_OAUTH_TOKEN_EXPIRED',
  'ERR_PROVIDER_NOT_CONFIGURED',
])

/**
 * A task error is provider-class when either:
 *   a) the daemon gave us a provider-class error code, or
 *   b) we observed an `llmservice:error` broadcast for this task.
 *
 * The `llmservice:error` fallback exists because the daemon doesn't always
 * propagate the structured code through `task:error` — `CipherAgent.run()`
 * unwraps the fatal LlmError into a bare `new Error(message)` before the
 * TaskError serializer runs.
 */
export function isProviderTaskError({error, hadLlmServiceError}: Input): boolean {
  if (hadLlmServiceError) return true
  if (error?.code && PROVIDER_CODES.has(error.code)) return true
  return false
}
