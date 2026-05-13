import {
  AGENT_LLM_ITERATION_BUDGET_MS,
  AGENT_LLM_REQUEST_TIMEOUT_MS,
  AGENT_MAX_CONCURRENT_TASKS,
  AGENT_POOL_MAX_SIZE,
  TASK_HISTORY_DEFAULT_MAX_ENTRIES,
} from '../../../constants.js'

/**
 * Descriptor for a single user-configurable setting.
 * Defaults reference the existing constants module so a constant change
 * automatically updates the setting's default.
 */
export type SettingDescriptor = {
  readonly default: number
  readonly description: string
  readonly key: string
  readonly max: number
  readonly min: number
  readonly restartRequired: true
  readonly type: 'integer'
}

/**
 * View of one setting: the key, the user's current override (or the default
 * if none is set), and the registered default.
 */
export type SettingItem = {
  readonly current: number
  readonly default: number
  readonly key: string
  readonly restartRequired: true
}

/**
 * Single source of truth for setting key names. Importers must reference
 * these constants instead of inline string literals so a rename of one
 * key is a typecheck error at every call site (validator, bootstrap,
 * agent snapshot read, CLI tests).
 */
export const SETTINGS_KEYS = {
  AGENT_POOL_MAX_CONCURRENT_TASKS: 'agentPool.maxConcurrentTasksPerProject',
  AGENT_POOL_MAX_SIZE: 'agentPool.maxSize',
  LLM_ITERATION_BUDGET_MS: 'llm.iterationBudgetMs',
  LLM_REQUEST_TIMEOUT_MS: 'llm.requestTimeoutMs',
  TASK_HISTORY_MAX_ENTRIES: 'taskHistory.maxEntries',
} as const

export const SETTINGS_REGISTRY: readonly SettingDescriptor[] = [
  {
    default: AGENT_POOL_MAX_SIZE,
    description: 'Maximum number of concurrent active projects (one agent process per project).',
    key: SETTINGS_KEYS.AGENT_POOL_MAX_SIZE,
    max: 100,
    min: 1,
    restartRequired: true,
    type: 'integer',
  },
  {
    default: AGENT_MAX_CONCURRENT_TASKS,
    description: 'Maximum number of parallel curate/query tasks within a single project.',
    key: SETTINGS_KEYS.AGENT_POOL_MAX_CONCURRENT_TASKS,
    max: 50,
    min: 1,
    restartRequired: true,
    type: 'integer',
  },
  {
    default: AGENT_LLM_ITERATION_BUDGET_MS,
    description:
      'Maximum wall-clock budget for the agentic loop on one task, in milliseconds. Raise for slow local LLMs (Ollama on CPU); lower for faster failure detection on cloud providers.',
    key: SETTINGS_KEYS.LLM_ITERATION_BUDGET_MS,
    max: 7_200_000,
    min: 60_000,
    restartRequired: true,
    type: 'integer',
  },
  {
    default: AGENT_LLM_REQUEST_TIMEOUT_MS,
    description:
      'Maximum wall-clock budget for one direct LLM HTTP request, in milliseconds. Must be <= llm.iterationBudgetMs. Raise for slow local LLMs (Ollama, LM Studio).',
    key: SETTINGS_KEYS.LLM_REQUEST_TIMEOUT_MS,
    max: 7_200_000,
    min: 10_000,
    restartRequired: true,
    type: 'integer',
  },
  {
    default: TASK_HISTORY_DEFAULT_MAX_ENTRIES,
    description: 'Maximum number of task records `brv query-log view` retains per project.',
    key: SETTINGS_KEYS.TASK_HISTORY_MAX_ENTRIES,
    max: 100_000,
    min: 10,
    restartRequired: true,
    type: 'integer',
  },
]

export function findSettingDescriptor(key: string): SettingDescriptor | undefined {
  return SETTINGS_REGISTRY.find((d) => d.key === key)
}
