/**
 * Environment types supported by the CLI.
 */
type Environment = 'development' | 'production'

const isEnvironment = (value: unknown): value is Environment => value === 'development' || value === 'production'

/**
 * Current environment - set at runtime by the launcher scripts.
 * - `./bin/dev.js` sets BRV_ENV=development
 * - `./bin/run.js` sets BRV_ENV=production
 */
const envValue = process.env.BRV_ENV
export const ENVIRONMENT: Environment = isEnvironment(envValue) ? envValue : 'development'

/**
 * Environment-specific configuration.
 *
 * Base URL vars (BRV_IAM_BASE_URL, BRV_COGIT_BASE_URL, BRV_LLM_BASE_URL)
 * store only the root domain (e.g., http://localhost:8080).
 * API version paths (/api/v1, /api/v3) are appended at the point of use.
 *
 * OIDC URLs are derived from iamBaseUrl; no separate env vars needed.
 */
type EnvironmentConfig = {
  authorizationUrl: string
  clientId: string
  cogitBaseUrl: string
  gitRemoteBaseUrl: string
  hubRegistryUrl: string
  iamBaseUrl: string
  issuerUrl: string
  llmBaseUrl: string
  scopes: string[]
  tokenUrl: string
  webAppUrl: string
}

/**
 * Non-infrastructure config that stays in source (same across envs or not sensitive).
 */
const DEFAULTS = {
  clientId: 'byterover-cli-client',
  hubRegistryUrl: 'https://hub.byterover.dev/r/registry.json',
  scopes: {
    development: ['read', 'write', 'debug'],
    production: ['read', 'write'],
  },
} as const

const readRequiredEnv = (name: string): string => {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}. Ensure .env files are loaded via dotenv.`)
  }

  return value
}

export const getCurrentConfig = (): EnvironmentConfig => {
  const iamBaseUrl = readRequiredEnv('BRV_IAM_BASE_URL')
  const oidcBase = `${iamBaseUrl}/api/v1/oidc`

  return {
    authorizationUrl: `${oidcBase}/authorize`,
    clientId: DEFAULTS.clientId,
    cogitBaseUrl: readRequiredEnv('BRV_COGIT_BASE_URL'),
    gitRemoteBaseUrl: readRequiredEnv('BRV_GIT_REMOTE_BASE_URL'),
    hubRegistryUrl: DEFAULTS.hubRegistryUrl,
    iamBaseUrl,
    issuerUrl: oidcBase,
    llmBaseUrl: readRequiredEnv('BRV_LLM_BASE_URL'),
    scopes: [...DEFAULTS.scopes[ENVIRONMENT]],
    tokenUrl: `${oidcBase}/token`,
    webAppUrl: readRequiredEnv('BRV_WEB_APP_URL'),
  }
}

export const getGitRemoteBaseUrl = (): string =>
  process.env.BRV_GIT_REMOTE_BASE_URL ?? 'https://byterover.dev'

export const isDevelopment = (): boolean => ENVIRONMENT === 'development'
