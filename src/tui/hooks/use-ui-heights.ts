/* eslint-disable perfectionist/sort-objects */

/**
 * useUIHeights Hook
 *
 * Provides breakpoint-specific height configuration for all UI elements.
 * Returns the complete configuration object from BREAKPOINT_HEIGHTS
 * based on current terminal size, including header, tab, footer, messageItem,
 * commandItem, and appBottomPadding values.
 */

import {useTerminalBreakpoint} from './use-terminal-breakpoint.js'

/**
 * Configuration object defining all UI element heights per breakpoint
 *
 * Single source of truth for UI layout across different terminal sizes.
 * Each breakpoint defines a complete set of height values for all UI elements.
 *
 * Breakpoints:
 * - compact (0-23 rows): Minimal heights for small terminals
 * - normal (≥24 rows): Standard heights for comfortable viewing
 *
 * Note: Object keys are ordered top-to-bottom according to actual UI layout.
 * perfectionist/sort-objects is disabled to preserve this logical ordering.
 */
const BREAKPOINT_HEIGHTS = {
  compact: {
    header: 2,
    tab: 3,
    messageItem: {
      header: 1,
      input: 3,
      maxProgressItems: 2,
      contentBottomMargin: 0,
      maxChanges: {
        created: 2,
        updated: 2,
      },
      bottomMargin: 1,
    },
    commandInput: 3,
    footer: 1,
    appBottomPadding: 0,
  },
  normal: {
    header: 2,
    tab: 3,
    messageItem: {
      header: 1,
      input: 3,
      maxProgressItems: 3,
      contentBottomMargin: 1,
      maxChanges: {
        created: 3,
        updated: 3,
      },
      bottomMargin: 1,
    },
    commandInput: 3,
    footer: 1,
    appBottomPadding: 0,
  },
} as const

/**
 * Message item heights interface
 *
 * Defines height constraints for individual message item components
 * in the activity logs view. These values control how much vertical
 * space each part of a message can consume.
 *
 */
export interface MessageItemHeights {
  bottomMargin: number
  contentBottomMargin: number
  header: number
  input: number
  maxChanges: {
    created: number
    updated: number
  }
  maxContentLines: number
  maxProgressItems: number
}

/**
 * Breakpoint configuration type derived from BREAKPOINT_HEIGHTS
 *
 * Single source of truth - directly represents the configuration structure.
 * This type automatically infers the shape from BREAKPOINT_HEIGHTS object,
 * ensuring type safety when accessing height values.
 *
 * Structure:
 * - header: Height of header section
 * - tab: Height of tab bar
 * - footer: Height of footer section
 * - messageItem: Nested heights for message item components
 * - appBottomPadding: Bottom padding for the entire app
 */
export type BreakpointConfig = typeof BREAKPOINT_HEIGHTS[keyof typeof BREAKPOINT_HEIGHTS]

/**
 * Complete UI heights return type
 *
 * Extends BreakpointConfig with the current breakpoint name.
 * Use this to access all height values directly without nested structure.
 *
 * @example
 * const {breakpoint, header, tab, footer, messageItem, appBottomPadding} = useUIHeights()
 * const totalFixed = header + tab + footer
 */
export type UIHeights = BreakpointConfig & {
  breakpoint: 'compact' | 'normal'
}

/**
 * Hook for providing breakpoint-specific UI heights
 *
 * Detects the current terminal breakpoint and returns the corresponding
 * height configuration from BREAKPOINT_HEIGHTS. All height values are
 * returned at the top level for easy destructuring.
 *
 * @returns {UIHeights} Object containing:
 *   - breakpoint: Current breakpoint ('compact' | 'normal')
 *   - header: Header section height
 *   - tab: Tab bar height
 *   - footer: Footer section height
 *   - messageItem: Message item component heights
 *   - appBottomPadding: App bottom padding
 *
 * @example
 * const {breakpoint, header, tab, footer, messageItem} = useUIHeights()
 * const availableHeight = terminalRows - header - tab - footer
 */
export function useUIHeights(): UIHeights {
  const {breakpoint} = useTerminalBreakpoint()

  const config = BREAKPOINT_HEIGHTS[breakpoint]

  return {
    breakpoint,
    ...config,
  }
}
