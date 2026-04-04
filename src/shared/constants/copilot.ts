/** GitHub Copilot CLI App client ID (public — used for device flow, no client secret). */
export const COPILOT_GITHUB_CLIENT_ID = 'Iv1.b507a08c87ecfe98'

/** GitHub device code request endpoint. */
export const GITHUB_DEVICE_CODE_URL = 'https://github.com/login/device/code'

/** GitHub OAuth token endpoint (used for device flow polling). */
export const GITHUB_OAUTH_TOKEN_URL = 'https://github.com/login/oauth/access_token'

/** GitHub Copilot internal token exchange endpoint. */
export const COPILOT_TOKEN_URL = 'https://api.github.com/copilot_internal/v2/token'

/** Copilot API base URL (serves both OpenAI-compatible and Anthropic-compatible endpoints). */
export const COPILOT_API_BASE_URL = 'https://api.githubcopilot.com'

/** OAuth scope required for Copilot access. */
export const COPILOT_OAUTH_SCOPE = 'read:user'

/** GitHub device flow verification URI (where users enter their code). */
export const GITHUB_DEVICE_VERIFICATION_URL = 'https://github.com/login/device'

/** Default polling interval for device flow (seconds). */
export const DEVICE_FLOW_DEFAULT_INTERVAL = 5

/** Extra seconds to add to polling interval as a safety margin. */
export const DEVICE_FLOW_INTERVAL_BUFFER = 3

/** Copilot models endpoint for listing available models. */
export const COPILOT_MODELS_ENDPOINT = '/models'

export const GITHUB_API_VERSION = '2025-04-01'

/** Editor version header value sent with Copilot API requests. */
export const COPILOT_EDITOR_VERSION = 'vscode/1.99.0'

/** Standard headers required for Copilot API requests. */
export const COPILOT_REQUEST_HEADERS = {
  'Copilot-Integration-Id': 'vscode-chat',
  'Editor-Version': COPILOT_EDITOR_VERSION,
} as const
