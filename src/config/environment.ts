/**
 * Environment types supported by the CLI.
 */
type Environment = 'development' | 'production'

/**
 * Current environment - set at runtime by the launcher scripts.
 * - `./bin/dev.js` sets BRV_ENV=development
 * - `./bin/run.js` sets BRV_ENV=production
 */
export const ENVIRONMENT = (process.env.BRV_ENV as Environment) ?? 'development'

/**
 * Environment-specific configuration.
 */
type EnvironmentConfig = {
  apiBaseUrl: string
  authorizationUrl: string
  clientId: string
  cogitApiBaseUrl: string
  issuerUrl: string
  llmApiBaseUrl: string
  memoraApiBaseUrl: string
  mixpanelToken: string
  scopes: string[]
  tokenUrl: string
  webAppUrl: string
}

/**
 * Configuration for each environment.
 * These values are bundled at build time.
 */
export const ENV_CONFIG: Record<Environment, EnvironmentConfig> = {
  development: {
    apiBaseUrl: 'https://dev-beta-iam.byterover.dev/api/v1',
    authorizationUrl: 'https://dev-beta-iam.byterover.dev/api/v1/oidc/authorize',
    clientId: 'byterover-cli-client',
    cogitApiBaseUrl: 'https://dev-beta-cgit.byterover.dev/api/v1',
    issuerUrl: 'https://dev-beta-iam.byterover.dev/api/v1/oidc',
    llmApiBaseUrl: 'https://dev-beta-llm.byterover.dev',
    memoraApiBaseUrl: 'https://dev-beta-memora-retrieve.byterover.dev/api/v3',
    mixpanelToken: '258e1a2b3d44cc634ef28964771b1da0',
    scopes: ['read', 'write', 'debug'],
    tokenUrl: 'https://dev-beta-iam.byterover.dev/api/v1/oidc/token',
    webAppUrl: 'https://dev-beta-app.byterover.dev',
  },
  production: {
    apiBaseUrl: 'https://iam.byterover.dev/api/v1',
    authorizationUrl: 'https://iam.byterover.dev/api/v1/oidc/authorize',
    clientId: 'byterover-cli-client',
    cogitApiBaseUrl: 'https://v3-cgit.byterover.dev',
    issuerUrl: 'https://iam.byterover.dev/api/v1/oidc',
    llmApiBaseUrl: 'https://llm.byterover.dev',
    memoraApiBaseUrl: 'https://beta-memora-retrieve.byterover.dev/api/v3',
    mixpanelToken: 'fac9051df8242c885a9e0eaf60f78b10',
    scopes: ['read', 'write'],
    tokenUrl: 'https://iam.byterover.dev/api/v1/oidc/token',
    webAppUrl: 'https://app.byterover.dev',
  },
}

/**
 * Get the configuration for the current environment.
 * @returns The environment configuration.
 */
export const getCurrentConfig = (): EnvironmentConfig => ENV_CONFIG[ENVIRONMENT]

/**
 * Check if the current environment is development.
 * @returns True if in development mode, false otherwise.
 */
export const isDevelopment = (): boolean => ENVIRONMENT === 'development'
