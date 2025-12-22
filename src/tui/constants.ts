/**
 * TUI Constants
 */

import type {Tab} from './types.js'

export const TABS: Tab[] = [
  {id: 'activity', label: 'Activity'},
  {id: 'console', label: 'Console'},
]

export const DEFAULT_TAB = 'activity' as const
