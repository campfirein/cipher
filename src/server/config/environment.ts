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
 */
type EnvironmentConfig = {
  apiBaseUrl: string
  authorizationUrl: string
  clientId: string
  cogitApiBaseUrl: string
  gitRemoteBaseUrl: string
  hubRegistryUrl: string
  issuerUrl: string
  llmApiBaseUrl: string
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

export const getCurrentConfig = (): EnvironmentConfig => ({
  apiBaseUrl: readRequiredEnv('BRV_API_BASE_URL'),
  authorizationUrl: readRequiredEnv('BRV_AUTHORIZATION_URL'),
  clientId: DEFAULTS.clientId,
  cogitApiBaseUrl: readRequiredEnv('BRV_COGIT_API_BASE_URL'),
  gitRemoteBaseUrl: readRequiredEnv('BRV_GIT_REMOTE_BASE_URL'),
  hubRegistryUrl: DEFAULTS.hubRegistryUrl,
  issuerUrl: readRequiredEnv('BRV_ISSUER_URL'),
  llmApiBaseUrl: readRequiredEnv('BRV_LLM_API_BASE_URL'),
  scopes: [...DEFAULTS.scopes[ENVIRONMENT]],
  tokenUrl: readRequiredEnv('BRV_TOKEN_URL'),
  webAppUrl: readRequiredEnv('BRV_WEB_APP_URL'),
})

export const getGitRemoteBaseUrl = (): string =>
  process.env.BRV_GIT_REMOTE_BASE_URL ?? 'https://byterover.dev'

export const isDevelopment = (): boolean => ENVIRONMENT === 'development'
