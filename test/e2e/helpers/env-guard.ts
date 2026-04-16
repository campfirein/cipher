export type E2eConfig = {
  apiBaseUrl: string
  apiKey: string
  cogitApiBaseUrl: string
  gitRemoteBaseUrl: string
  llmApiBaseUrl: string
  webAppUrl: string
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
 * BRV_E2E_API_KEY is required; all other variables default to dev-beta URLs.
 */
export const getE2eConfig =  (): E2eConfig => {
  const apiKey = process.env.BRV_E2E_API_KEY
  if (!apiKey) {
    throw new Error('BRV_E2E_API_KEY is required. See test/e2e/README.md')
  }

  return {
    apiBaseUrl: process.env.BRV_API_BASE_URL ?? 'https://dev-beta-iam.byterover.dev/api/v1',
    apiKey,
    cogitApiBaseUrl: process.env.BRV_COGIT_API_BASE_URL ?? 'https://dev-beta-cgit.byterover.dev/api/v1',
    gitRemoteBaseUrl: process.env.BRV_GIT_REMOTE_BASE_URL ?? 'https://dev-beta.byterover.dev',
    llmApiBaseUrl: process.env.BRV_LLM_API_BASE_URL ?? 'https://dev-beta-llm.byterover.dev',
    webAppUrl: process.env.BRV_WEB_APP_URL ?? 'https://dev-beta-app.byterover.dev',
  }
}
