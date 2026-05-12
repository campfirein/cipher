import {AGENT_MAX_CONCURRENT_TASKS, AGENT_POOL_MAX_SIZE, TASK_HISTORY_DEFAULT_MAX_ENTRIES} from '../../../constants.js'

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

export const SETTINGS_REGISTRY: readonly SettingDescriptor[] = [
  {
    default: AGENT_POOL_MAX_SIZE,
    description: 'Maximum number of concurrent active projects (one agent process per project).',
    key: 'agentPool.maxSize',
    max: 100,
    min: 1,
    restartRequired: true,
    type: 'integer',
  },
  {
    default: AGENT_MAX_CONCURRENT_TASKS,
    description: 'Maximum number of parallel curate/query tasks within a single project.',
    key: 'agentPool.maxConcurrentTasksPerProject',
    max: 50,
    min: 1,
    restartRequired: true,
    type: 'integer',
  },
  {
    default: TASK_HISTORY_DEFAULT_MAX_ENTRIES,
    description: 'Maximum number of task records `brv query-log view` retains per project.',
    key: 'taskHistory.maxEntries',
    max: 100_000,
    min: 10,
    restartRequired: true,
    type: 'integer',
  },
]

export function findSettingDescriptor(key: string): SettingDescriptor | undefined {
  return SETTINGS_REGISTRY.find((d) => d.key === key)
}
