/**
 * Feed Navigation Hook
 *
 * Handles keyboard navigation for the activity feed:
 * - Up/Down arrows to navigate items
 * - Ctrl+O to expand/collapse selected item
 * - Escape to collapse expanded item
 */

import {useInput} from 'ink'
import {useEffect, useState} from 'react'

interface UseFeedNavigationOptions {
  /** Total number of items in the feed */
  itemCount: number
  /** Whether navigation is active */
  isActive: boolean // eslint-disable-line perfectionist/sort-interfaces
  /** Current expanded index (null if none expanded) */
  expandedIndex: null | number // eslint-disable-line perfectionist/sort-interfaces
  /** Callback when expanded index changes */
  onExpandedIndexChange: (index: null | number) => void
}

interface UseFeedNavigationReturn {
  /** Currently selected index */
  selectedIndex: number
}

export function useFeedNavigation({
  expandedIndex,
  isActive,
  itemCount,
  onExpandedIndexChange,
}: UseFeedNavigationOptions): UseFeedNavigationReturn {
  const [selectedIndex, setSelectedIndex] = useState(0)

  // Auto-select last item when item count changes
  useEffect(() => {
    if (itemCount === 0) return
    setSelectedIndex(itemCount - 1)
  }, [itemCount])

  useInput(
    (input, key) => {
      // Toggle expand on Ctrl+O
      if (key.ctrl && input === 'o') {
        if (expandedIndex === selectedIndex) {
          onExpandedIndexChange(null)
        } else {
          onExpandedIndexChange(selectedIndex)
        }
      }

      // Navigate up
      if (key.upArrow) {
        setSelectedIndex((prev) => Math.max(0, prev - 1))
      }

      // Navigate down
      if (key.downArrow) {
        setSelectedIndex((prev) => Math.min(prev + 1, itemCount - 1))
      }

      // Collapse on Escape
      if (key.escape && expandedIndex !== null) {
        onExpandedIndexChange(null)
      }
    },
    {isActive},
  )

  return {selectedIndex}
}
