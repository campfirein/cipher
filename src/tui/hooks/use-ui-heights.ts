 
/* eslint-disable perfectionist/sort-objects */
// Need to disable here as we need to order the object keys according to the real UI layout

/**
 * useUIHeights Hook
 *
 * Calculates all UI element heights based on terminal breakpoint.
 * Returns height allocation for fixed elements (header, tab, footer)
 * and dynamic message item parts (progress, content, changes).
 */

import {useTerminalBreakpoint} from './use-terminal-breakpoint.js'

/**
 * Configuration object defining all heights per breakpoint
 * Single source of truth for UI layout
 */
const BREAKPOINT_HEIGHTS = {
  // compact (0 - 21) rows total: 19
  compact: {
    header: 2,
    tab: 3,
    messageItem: {
      header: 1,
      input: 3,
      maxProgressItems: 2,
      maxContent: {
        max: 3,
        bottomMargin: 0,
      },
      maxChanges: {
        created: 2,
        updated: 2,
      },
      bottomMargin: 1,
    },
    footer: 2,
    appBottomPadding: 0
  },

  // normal (>= 22) rows total: 25
  normal: {
    header: 2,
    tab: 3,
    messageItem: {
      header: 1,
      input: 3,
      maxProgressItems: 3,
      maxContent: {
        max: 3,
        bottomMargin: 1,
      },
      maxChanges: {
        created: 3,
        updated: 3,
      },
      bottomMargin: 1,
    },
    footer: 2,
    appBottomPadding: 0
  },
} as const

/**
 * Message item heights interface
 */
export interface MessageItemHeights {
  bottomMargin: number // Bottom margin for entire message item
  header: number
  input: number
  maxChanges: {
    created: number
    updated: number
  }
  maxContent: {
    bottomMargin: number
    max: number
  }
  maxProgressItems: number
}

/**
 * Complete UI heights interface
 */
export interface UIHeights {
  appBottomPadding: number
  available: {
    content: number
  }
  breakpoint: 'compact' | 'normal'
  fixed: {
    footer: number
    header: number
    tab: number
    total: number
  }
  messageItem: MessageItemHeights
  terminal: {
    columns: number
    rows: number
  }
}

/**
 * Hook for calculating UI heights based on terminal breakpoint
 *
 * @returns All height values for UI layout
 */
export function useUIHeights(): UIHeights {
  const {breakpoint, columns, rows} = useTerminalBreakpoint()

  // Get all heights from breakpoint configuration
  const config = BREAKPOINT_HEIGHTS[breakpoint]

  const fixed = {
    footer: config.footer,
    header: config.header,
    tab: config.tab,
    total: config.header + config.tab + config.footer, // 7
  }

  return {
    available: {content: rows - fixed.total},
    breakpoint,
    fixed,
    messageItem: config.messageItem,
    terminal: {columns, rows},
    appBottomPadding: config.appBottomPadding
  }
}
