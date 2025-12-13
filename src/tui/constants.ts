/**
 * TUI Constants
 */

import type {Tab} from './types.js'

export const TABS: Tab[] = [
  {id: 'activity', label: 'Activity'},
  {id: 'console', label: 'Console'},
]

export const LAYOUT = {
  footerHeight: 2,
  headerHeight: 4,
  tabBarHeight: 2,
} as const

export const DEFAULT_TAB = 'activity' as const
