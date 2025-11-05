/**
 * Environment types supported by the CLI.
 */
type Environment = 'development' | 'production'

/**
 * Current environment - set at runtime by the launcher scripts.
 * - `./bin/dev.js` sets BRV_ENV=development
 * - `./bin/run.js` sets BRV_ENV=production
 */
export const ENVIRONMENT: Environment = (process.env.BRV_ENV as Environment) ?? 'development'

/**
 * Environment-specific configuration.
 */
type EnvironmentConfig = {
  apiBaseUrl: string
  authorizationUrl: string
  clientId: string
  cogitApiBaseUrl: string
  issuerUrl: string
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
    cogitApiBaseUrl: 'https://dev-beta-cogit.byterover.dev/api/v1',
    issuerUrl: 'https://dev-beta-iam.byterover.dev/api/v1/oidc',
    memoraApiBaseUrl: 'https://dev-beta-memora-retrieve.byterover.dev/api/v3',
    mixpanelToken: '258e1a2b3d44cc634ef28964771b1da0',
    scopes: ['read', 'write', 'debug'],
    tokenUrl: 'https://dev-beta-iam.byterover.dev/api/v1/oidc/token',
    webAppUrl: 'https://dev-beta-app.byterover.dev/',
  },
  production: {
    apiBaseUrl: 'https://beta-iam.byterover.dev/api/v1',
    authorizationUrl: 'https://beta-iam.byterover.dev/api/v1/oidc/authorize',
    clientId: 'byterover-cli',
    cogitApiBaseUrl: 'https://beta-cogit.byterover.dev/api/v1',
    issuerUrl: 'https://beta-iam.byterover.dev/api/v1/oidc',
    memoraApiBaseUrl: 'https://beta-memora-retrieve.byterover.dev/api/v3',
    mixpanelToken: '4d1198b346d2d6ac75f2e77905cc65ac',
    scopes: ['read', 'write'],
    tokenUrl: 'https://beta-iam.byterover.dev/api/v1/oidc/token',
    webAppUrl: 'https://beta-app.byterover.dev',
  },
}

/**
 * Get the configuration for the current environment.
 * @returns The environment configuration.
 */
export const getCurrentConfig = (): EnvironmentConfig => ENV_CONFIG[ENVIRONMENT]
