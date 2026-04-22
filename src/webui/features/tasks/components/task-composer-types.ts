export type ComposerType = 'curate' | 'query'

export const PLACEHOLDER: Record<ComposerType, string> = {
  curate:
    'JWT tokens expire after 24h. Refresh window is 7 days. Rotation happens on every successful refresh — old refresh token is invalidated immediately.',
  query: 'What is our auth token expiration policy?',
}

export const HELP: Record<ComposerType, string> = {
  curate: 'Plain text knowledge to capture into the project context tree.',
  query: 'The agent searches the project context tree and synthesizes an answer.',
}
