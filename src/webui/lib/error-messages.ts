import {VcErrorCode} from '../../shared/transport/events/vc-events'

export interface ErrorContext {
  projectPath?: string
}

type OverrideValue = ((ctx: ErrorContext) => string) | string

// Override map for daemon error codes whose messages reference CLI-only affordances (REPL slash-commands, brv shell).
const OVERRIDES: Record<string, OverrideValue> = {
  // Auth / providers
  ERR_NOT_AUTHENTICATED: 'Please sign in to continue.',
  ERR_PROVIDER_NOT_CONFIGURED: 'No provider is connected, or its credentials are missing or expired.',

  // Version control
  [VcErrorCode.ALREADY_INITIALIZED]: 'Version control is already initialized for this project.',
  [VcErrorCode.AUTH_FAILED]: 'Authentication failed. Please sign in and try again.',
  [VcErrorCode.BRANCH_NOT_FOUND]: 'Branch not found. You can create a new branch if needed.',
  [VcErrorCode.NO_COMMITS]: 'Make at least one commit before continuing.',
  [VcErrorCode.NO_REMOTE]: 'No remote configured for this project.',
  [VcErrorCode.NO_UPSTREAM]:
    'This branch has no upstream configured yet. Use the Push button to publish it and set upstream in one step.',
  [VcErrorCode.NON_FAST_FORWARD]: 'The remote has changes. Pull first, then try again.',
  [VcErrorCode.NOTHING_TO_PUSH]: 'Nothing to push — stage and commit your changes first.',
  [VcErrorCode.REMOTE_ALREADY_EXISTS]:
    "A remote named 'origin' already exists. Remove or rename it before adding a new one.",
  [VcErrorCode.USER_NOT_CONFIGURED]: 'Commit author is not configured.',
}

const DEFAULT_FALLBACK = 'Something went wrong'

function hasStringProp<K extends string>(value: unknown, key: K): value is Record<K, string> {
  return typeof value === 'object' && value !== null && key in value && typeof (value as Record<K, unknown>)[key] === 'string'
}

export function formatError(error: unknown, fallback: string = DEFAULT_FALLBACK, context: ErrorContext = {}): string {
  if (hasStringProp(error, 'code')) {
    const override = OVERRIDES[error.code]
    if (override !== undefined) {
      return typeof override === 'function' ? override(context) : override
    }
  }

  if (hasStringProp(error, 'message')) {
    return error.message
  }

  return fallback
}
