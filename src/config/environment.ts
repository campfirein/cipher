/**
 * Environment types supported by the CLI.
 */
export type Environment = 'development' | 'production'

/**
 * Current environment - set at build time via BR_BUILD_ENV.
 */
export const ENVIRONMENT: Environment = (process.env.BR_BUILD_ENV as Environment) ?? 'development'

/**
 * Environment-specific configuration.
 */
export type EnvironmentConfig = {
  clientId: string
  issuerUrl: string
  scopes: string[]
}

/**
 * Configuration for each environment.
 * These values are bundled at build time.
 */
export const ENV_CONFIG: Record<Environment, EnvironmentConfig> = {
  development: {
    clientId: 'byterover-cli-client',
    issuerUrl: 'https://dev-beta-iam.byterover.dev/api/v1/oidc',
    scopes: ['read', 'write', 'debug'],
  },
  production: {
    clientId: 'byterover-cli-prod',
    issuerUrl: 'https://prod-beta-iam.byterover.dev/api/v1/oidc',
    scopes: ['read', 'write'],
  },
}

/**
 * Get the configuration for the current environment.
 * @returns The environment configuration.
 */
export const getCurrentConfig = (): EnvironmentConfig => ENV_CONFIG[ENVIRONMENT]
