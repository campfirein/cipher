// Override map for daemon error codes whose messages reference CLI-only affordances (REPL slash-commands, brv shell).
const OVERRIDES: Record<string, string> = {
  // Auth / providers
  ERR_NOT_AUTHENTICATED: 'Please sign in to continue.',

  ERR_PROVIDER_NOT_CONFIGURED: 'No provider is connected, or its credentials are missing or expired.',
  // Version control
  ERR_VC_ALREADY_INITIALIZED: 'Version control is already initialized for this project.',
  ERR_VC_AUTH_FAILED: 'Authentication failed. Please sign in and try again.',
  ERR_VC_BRANCH_NOT_FOUND: "Branch not found. You can create a new branch if needed.",
  ERR_VC_NO_COMMITS: 'Make at least one commit before continuing.',
  ERR_VC_NO_REMOTE: 'No remote is configured yet. Set one up before using pull, push, or fetch.',
  ERR_VC_NO_UPSTREAM:
    "This branch has no upstream configured yet. Use the Push button to publish it and set upstream in one step.",
  ERR_VC_NON_FAST_FORWARD: 'The remote has changes. Pull first, then try again.',
  ERR_VC_NOTHING_TO_PUSH: 'Nothing to push — stage and commit your changes first.',
  ERR_VC_REMOTE_ALREADY_EXISTS: "A remote named 'origin' already exists. Remove or rename it before adding a new one.",
  ERR_VC_USER_NOT_CONFIGURED: 'Set commit author via `brv vc config` before committing.',
}

const DEFAULT_FALLBACK = 'Something went wrong'

function hasStringProp<K extends string>(value: unknown, key: K): value is Record<K, string> {
  return typeof value === 'object' && value !== null && key in value && typeof (value as Record<K, unknown>)[key] === 'string'
}

export function formatError(error: unknown, fallback: string = DEFAULT_FALLBACK): string {
  if (hasStringProp(error, 'code') && OVERRIDES[error.code]) {
    return OVERRIDES[error.code]
  }

  if (hasStringProp(error, 'message')) {
    return error.message
  }

  return fallback
}
