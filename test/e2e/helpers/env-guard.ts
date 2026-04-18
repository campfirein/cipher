export type E2eConfig = {
  apiKey: string
  cogitBaseUrl: string
  gitRemoteBaseUrl: string
  iamBaseUrl: string
  llmBaseUrl: string
  webAppUrl: string
}

/** Strips trailing slashes and leading/trailing whitespace from a URL. */
const normalizeUrl = (url: string): string => url.trim().replace(/\/+$/, '')

/** Throws if the URL contains a path component (anything beyond '/'). */
const assertRootDomain = (name: string, url: string): void => {
  if (new URL(url).pathname !== '/') {
    throw new Error(
      `${name} must not include a path component. Provide the root domain only (e.g., https://example.com).`,
    )
  }
}

/**
 * Reads a required environment variable, trims whitespace, and normalizes
 * trailing slashes. Throws if the variable is missing or empty.
 */
const readRequiredEnv = (name: string): string => {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
      'Ensure .env.development is loaded via dotenv. See test/e2e/README.md',
    )
  }

  return normalizeUrl(value)
}

/**
 * Guard that skips the current Mocha suite if BRV_E2E_API_KEY is not set.
 * Pass directly to `before()` — Mocha binds `this` automatically.
 *
 * @example
 * describe('My E2E Suite', function () {
 *   before(requireE2eEnv)
 * })
 */
export function requireE2eEnv(this: {skip(): never}): void {
  if (!process.env.BRV_E2E_API_KEY) {
    console.log('Skipping E2E: BRV_E2E_API_KEY not set. See test/e2e/README.md')
    this.skip()
  }
}

/**
 * Returns typed E2E configuration from environment variables.
 *
 * All variables are required — no hardcoded defaults. Variable names and
 * validation match the runtime contract in src/server/config/environment.ts.
 * BRV_IAM_BASE_URL and BRV_COGIT_BASE_URL must be root domains (no path).
 */
export const getE2eConfig = (): E2eConfig => {
  const apiKey = process.env.BRV_E2E_API_KEY
  if (!apiKey) {
    throw new Error('BRV_E2E_API_KEY is required. See test/e2e/README.md')
  }

  const iamBaseUrl = readRequiredEnv('BRV_IAM_BASE_URL')
  assertRootDomain('BRV_IAM_BASE_URL', iamBaseUrl)

  const cogitBaseUrl = readRequiredEnv('BRV_COGIT_BASE_URL')
  assertRootDomain('BRV_COGIT_BASE_URL', cogitBaseUrl)

  return {
    apiKey,
    cogitBaseUrl,
    gitRemoteBaseUrl: readRequiredEnv('BRV_GIT_REMOTE_BASE_URL'),
    iamBaseUrl,
    llmBaseUrl: readRequiredEnv('BRV_LLM_BASE_URL'),
    webAppUrl: readRequiredEnv('BRV_WEB_APP_URL'),
  }
}
