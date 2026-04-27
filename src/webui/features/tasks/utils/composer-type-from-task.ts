import type {ComposerType} from '../components/task-composer-types'

/**
 * Map a stored task type to the composer's two-way switch. The composer only
 * knows about `curate` and `query` — server-side `curate-folder` and `search`
 * collapse onto those for the purposes of refilling the form.
 */
export function composerTypeFromTask(taskType: string): ComposerType {
  if (taskType === 'query' || taskType === 'search') return 'query'
  return 'curate'
}
