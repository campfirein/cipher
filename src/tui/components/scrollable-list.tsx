/**
 * ScrollableList Component
 *
 * Generic scrollable list that works reliably with Ink's layout.
 * Uses item-based slicing with dynamic height calculation.
 */

import {Box, Text, useInput} from 'ink'
import React, {useCallback, useEffect, useMemo, useState} from 'react'

export interface ScrollableListProps<T> {
  /** Auto-scroll to bottom when new items are added */
  autoScrollToBottom?: boolean
  /** Available height in lines for the list */
  availableHeight: number
  /** Estimate line count for an item (default: 1 line per item) */
  estimateItemHeight?: (item: T, index: number) => number
  /** Whether keyboard input is active for this list */
  isActive?: boolean
  /** Array of items to render */
  items: T[]
  /** Extract unique key for each item */
  keyExtractor: (item: T, index: number) => string
  /** Called when scroll position changes */
  onScroll?: (offset: number, total: number) => void
  /** Render function for each item */
  renderItem: (item: T, index: number) => React.ReactNode
  /** Scroll step size (items per keypress) */
  scrollStep?: number
  /** Show scroll position indicator */
  showIndicator?: boolean
}

export function ScrollableList<T>({
  autoScrollToBottom = true,
  availableHeight,
  estimateItemHeight = () => 1,
  isActive = true,
  items,
  keyExtractor,
  onScroll,
  renderItem,
  scrollStep = 1,
  showIndicator = true,
}: ScrollableListProps<T>): React.ReactElement {
  const [scrollOffset, setScrollOffset] = useState(0)

  const totalItems = items.length

  // Calculate which items are visible based on available height
  const {visibleEndIndex, visibleItems, visibleStartIndex} = useMemo(() => {
    if (totalItems === 0) {
      return {visibleEndIndex: 0, visibleItems: [] as T[], visibleStartIndex: 0}
    }

    // Calculate heights of all items
    const itemHeights: number[] = []
    for (let i = 0; i < totalItems; i++) {
      const h = estimateItemHeight(items[i], i)
      itemHeights.push(h)
    }

    // Reserve space for indicators (1 line each)
    const indicatorSpace = showIndicator ? 2 : 0
    const contentHeight = Math.max(1, availableHeight - indicatorSpace)

    // Find visible range starting from scrollOffset
    const startIdx = Math.min(scrollOffset, totalItems - 1)
    let endIdx = startIdx
    let accumulatedHeight = 0

    // Accumulate items until we fill the available height
    for (let i = startIdx; i < totalItems; i++) {
      if (accumulatedHeight + itemHeights[i] > contentHeight && i > startIdx) {
        break
      }

      accumulatedHeight += itemHeights[i]
      endIdx = i + 1
    }

    return {
      visibleEndIndex: endIdx,
      visibleItems: items.slice(startIdx, endIdx),
      visibleStartIndex: startIdx,
    }
  }, [items, totalItems, scrollOffset, availableHeight, estimateItemHeight, showIndicator])

  // Calculate max scroll offset
  const maxOffset = useMemo(() => {
    if (totalItems === 0) return 0

    // Find the minimum start index that shows the last item
    let maxStart = totalItems - 1
    const indicatorSpace = showIndicator ? 2 : 0
    const contentHeight = Math.max(1, availableHeight - indicatorSpace)
    let accumulatedHeight = 0

    for (let i = totalItems - 1; i >= 0; i--) {
      const h = estimateItemHeight(items[i], i)
      if (accumulatedHeight + h > contentHeight && i < totalItems - 1) {
        maxStart = i + 1
        break
      }

      accumulatedHeight += h
      maxStart = i
    }

    return maxStart
  }, [items, totalItems, availableHeight, estimateItemHeight, showIndicator])

  // Clamp scroll offset when items or height changes
  useEffect(() => {
    setScrollOffset((prev) => Math.min(prev, Math.max(0, maxOffset)))
  }, [maxOffset])

  // Auto-scroll to bottom when new items are added
  useEffect(() => {
    if (autoScrollToBottom && totalItems > 0) {
      setScrollOffset(maxOffset)
    }
  }, [autoScrollToBottom, totalItems, maxOffset])

  // Notify parent of scroll changes
  useEffect(() => {
    onScroll?.(scrollOffset, totalItems)
  }, [scrollOffset, totalItems, onScroll])

  const scrollUp = useCallback(() => {
    setScrollOffset((prev) => Math.max(0, prev - scrollStep))
  }, [scrollStep])

  const scrollDown = useCallback(() => {
    setScrollOffset((prev) => Math.min(maxOffset, prev + scrollStep))
  }, [maxOffset, scrollStep])

  const scrollToTop = useCallback(() => {
    setScrollOffset(0)
  }, [])

  const scrollToBottom = useCallback(() => {
    setScrollOffset(maxOffset)
  }, [maxOffset])

  useInput(
    (input, key) => {
      if (key.upArrow) {
        scrollUp()
      } else if (key.downArrow) {
        scrollDown()
      } else if (key.pageUp || (key.ctrl && input === 'u')) {
        // Page up - scroll by ~half viewport worth of items
        setScrollOffset((prev) => Math.max(0, prev - 3))
      } else if (key.pageDown || (key.ctrl && input === 'd')) {
        // Page down - scroll by ~half viewport worth of items
        setScrollOffset((prev) => Math.min(maxOffset, prev + 3))
      } else if (input === 'g' && !key.ctrl) {
        scrollToTop()
      } else if (input === 'G') {
        scrollToBottom()
      }
    },
    {isActive},
  )

  const canScrollUp = scrollOffset > 0
  const canScrollDown = scrollOffset < maxOffset
  const itemsAbove = visibleStartIndex
  const itemsBelow = totalItems - visibleEndIndex

  return (
    <Box flexDirection="column" width="100%">
      {/* Scroll up indicator */}
      {showIndicator && canScrollUp && (
        <Box justifyContent="center">
          <Text dimColor>↑ {itemsAbove} more above</Text>
        </Box>
      )}

      {/* Visible items */}
      {visibleItems.map((item, idx) => {
        const actualIndex = visibleStartIndex + idx
        return <React.Fragment key={keyExtractor(item, actualIndex)}>{renderItem(item, actualIndex)}</React.Fragment>
      })}

      {/* Scroll down indicator */}
      {showIndicator && canScrollDown && (
        <Box justifyContent="center">
          <Text dimColor>↓ {itemsBelow} more below</Text>
        </Box>
      )}
    </Box>
  )
}
