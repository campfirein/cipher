export type ComposerType = 'curate' | 'query'

export const PLACEHOLDER: Record<ComposerType, string> = {
  curate:
    'List the most important conventions and patterns used in this codebase — naming, file organization, testing approach, and any rules a new contributor should know before making changes.',
  query: 'What conventions should I follow when making changes?',
}

export const HELP: Record<ComposerType, string> = {
  curate: 'Plain text knowledge to capture into the project context tree.',
  query: 'The agent searches the project context tree and synthesizes an answer.',
}
