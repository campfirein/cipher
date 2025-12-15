/**
 * useVisibleWindow Hook
 *
 * Calculates a visible window of items based on selected index.
 * Used for scrollable lists that show a limited number of items
 * with a sliding window that follows the selection.
 */

import {useMemo} from 'react'

const DEFAULT_MAX_VISIBLE_ITEMS = 7

export interface UseVisibleWindowReturn<T> {
  /** The visible items within the window */
  visibleItems: T[]
  /** The starting index of the window in the original array */
  windowStart: number
}

/**
 * Hook for calculating a visible window of items
 *
 * @param items - The full array of items
 * @param selectedIndex - The currently selected index
 * @param maxVisibleItems - Maximum number of items to show (default: 7)
 * @returns The visible items and window start index
 */
export function useVisibleWindow<T>(
  items: T[],
  selectedIndex: number,
  maxVisibleItems: number = DEFAULT_MAX_VISIBLE_ITEMS,
): UseVisibleWindowReturn<T> {
  return useMemo(() => {
    if (items.length <= maxVisibleItems) {
      return {visibleItems: items, windowStart: 0}
    }

    // Calculate window start to keep selected item visible
    let start = 0
    if (selectedIndex >= maxVisibleItems) {
      // Selected item is beyond visible range, adjust window
      start = selectedIndex - maxVisibleItems + 1
    }

    // Ensure we don't go past the end
    const maxStart = items.length - maxVisibleItems
    start = Math.min(start, maxStart)

    return {
      visibleItems: items.slice(start, start + maxVisibleItems),
      windowStart: start,
    }
  }, [items, selectedIndex, maxVisibleItems])
}
