/**
 * Environment types supported by the CLI.
 */
type Environment = 'development' | 'production'

/**
 * Current environment - set at runtime by the launcher scripts.
 * - `./bin/dev.js` sets BR_ENV=development
 * - `./bin/run.js` sets BR_ENV=production
 */
export const ENVIRONMENT: Environment = (process.env.BR_ENV as Environment) ?? 'development'

/**
 * Environment-specific configuration.
 */
type EnvironmentConfig = {
  apiBaseUrl: string
  authorizationUrl: string
  clientId: string
  issuerUrl: string
  memoraApiBaseUrl: string
  scopes: string[]
  tokenUrl: string
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
    issuerUrl: 'https://dev-beta-iam.byterover.dev/api/v1/oidc',
    memoraApiBaseUrl: 'https://dev-beta-memora-retrieve.byterover.dev/api/v3',
    scopes: ['read', 'write', 'debug'],
    tokenUrl: 'https://dev-beta-iam.byterover.dev/api/v1/oidc/token',
  },
  production: {
    apiBaseUrl: 'https://prod-beta-iam.byterover.dev/api/v1',
    authorizationUrl: 'https://prod-beta-iam.byterover.dev/api/v1/oidc/authorize',
    clientId: 'byterover-cli-prod',
    issuerUrl: 'https://prod-beta-iam.byterover.dev/api/v1/oidc',
    memoraApiBaseUrl: 'https://prod-beta-memora-retrieve.byterover.dev/api/v3',
    scopes: ['read', 'write'],
    tokenUrl: 'https://prod-beta-iam.byterover.dev/api/v1/oidc/token',
  },
}

/**
 * Get the configuration for the current environment.
 * @returns The environment configuration.
 */
export const getCurrentConfig = (): EnvironmentConfig => ENV_CONFIG[ENVIRONMENT]
