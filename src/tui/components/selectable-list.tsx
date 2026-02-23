/**
 * SelectableList Component
 *
 * An interactive list with selection, search, grouping, and keyboard navigation.
 * Inspired by OpenCode's List component patterns.
 *
 * Features:
 * - Keyboard navigation (↑/↓, j/k, Enter, Esc)
 * - Fuzzy search filtering
 * - Grouping with headers
 * - Current item indicator (●)
 * - Customizable item rendering
 */

import {Box, Text, useInput} from 'ink'
import React, {useCallback, useEffect, useMemo, useState} from 'react'

import {useTheme} from '../hooks/index.js'

/**
 * Props for SelectableList component.
 */
export interface SelectableListProps<T> {
  /** Available height in lines */
  availableHeight?: number
  /** Current/selected item (shows ● indicator) */
  currentItem?: T
  /** Keys to use for filtering (searched with fuzzy match) */
  filterKeys: (item: T) => string[]
  /** Function to get item key for comparison with currentItem */
  getCurrentKey?: (item: T) => string
  /** Optional grouping function */
  groupBy?: (item: T) => string
  /** Hide the Cancel keybind hint and disable Esc to cancel */
  hideCancelButton?: boolean
  /** Initial search value */
  initialSearch?: string
  /** Whether keyboard input is active */
  isActive?: boolean
  /** Array of items to display */
  items: T[]
  /** Custom keybinds */
  keybinds?: Array<{
    action: (item: T) => void
    key: string
    label: string
  }>
  /** Function to get unique key for each item */
  keyExtractor: (item: T) => string
  /** Callback when selection is cancelled (Esc) */
  onCancel?: () => void
  /** Callback when an item is selected */
  onSelect: (item: T) => void
  /** Function to render each item */
  renderItem: (item: T, isActive: boolean, isCurrent: boolean) => React.ReactNode
  /** Placeholder for search input */
  searchPlaceholder?: string
  /** Title for the list */
  title?: string
}

/**
 * Simple fuzzy match function.
 * Returns true if all characters in the search string appear in order in the target.
 */
function fuzzyMatch(search: string, target: string): boolean {
  const searchLower = search.toLowerCase()
  const targetLower = target.toLowerCase()

  let searchIndex = 0
  for (let i = 0; i < targetLower.length && searchIndex < searchLower.length; i++) {
    if (targetLower[i] === searchLower[searchIndex]) {
      searchIndex++
    }
  }

  return searchIndex === searchLower.length
}

const MAX_VISIBLE_ITEMS = 10

export function SelectableList<T>({
  availableHeight = MAX_VISIBLE_ITEMS,
  currentItem,
  filterKeys,
  getCurrentKey,
  groupBy,
  hideCancelButton = false,
  initialSearch = '',
  isActive = true,
  items,
  keybinds = [],
  keyExtractor,
  onCancel,
  onSelect,
  renderItem,
  searchPlaceholder = 'Search...',
  title,
}: SelectableListProps<T>): React.ReactElement {
  const {
    theme: {colors},
  } = useTheme()
  const [searchValue, setSearchValue] = useState(initialSearch)
  const [selectedIndex, setSelectedIndex] = useState(0)

  // Filter items based on search
  const filteredItems = useMemo(() => {
    if (!searchValue.trim()) {
      return items
    }

    return items.filter((item) => {
      const searchableStrings = filterKeys(item)
      return searchableStrings.some((str) => fuzzyMatch(searchValue, str))
    })
  }, [items, searchValue, filterKeys])

  // Group items if groupBy is provided
  const groupedItems = useMemo(() => {
    if (!groupBy) {
      return [{group: '', items: filteredItems}]
    }

    const groups = new Map<string, T[]>()
    for (const item of filteredItems) {
      const group = groupBy(item)
      if (!groups.has(group)) {
        groups.set(group, [])
      }

      groups.get(group)!.push(item)
    }

    return [...groups.entries()].map(([group, groupItems]) => ({
      group,
      items: groupItems,
    }))
  }, [filteredItems, groupBy])

  // Flat list of items for navigation
  const flatItems = useMemo(() => groupedItems.flatMap((g) => g.items), [groupedItems])

  // Reset selection when items change
  useEffect(() => {
    setSelectedIndex(0)
  }, [searchValue])

  // Clamp selected index
  useEffect(() => {
    if (selectedIndex >= flatItems.length) {
      setSelectedIndex(Math.max(0, flatItems.length - 1))
    }
  }, [flatItems.length, selectedIndex])

  const moveUp = useCallback(() => {
    setSelectedIndex((prev) => Math.max(0, prev - 1))
  }, [])

  const moveDown = useCallback(() => {
    setSelectedIndex((prev) => Math.min(flatItems.length - 1, prev + 1))
  }, [flatItems.length])

  const selectCurrent = useCallback(() => {
    if (flatItems.length > 0 && selectedIndex < flatItems.length) {
      onSelect(flatItems[selectedIndex])
    }
  }, [flatItems, selectedIndex, onSelect])

  const handleNavigation = useCallback(
    (
      input: string,
      key: {
        ctrl?: boolean
        downArrow?: boolean
        meta?: boolean
        upArrow?: boolean
      },
    ) => {
      if (key.upArrow) {
        moveUp()
        return true
      }

      if (key.downArrow) {
        moveDown()
        return true
      }

      if (!key.ctrl && !key.meta) {
        setSelectedIndex(0)
        return true
      }

      return false
    },
    [flatItems.length, moveDown, moveUp],
  )

  const handleCustomKeybinds = useCallback(
    (input: string) => {
      for (const keybind of keybinds) {
        if (input === keybind.key && flatItems.length > 0) {
          keybind.action(flatItems[selectedIndex])
          return true
        }
      }

      return false
    },
    [flatItems, keybinds, selectedIndex],
  )

  // Handle keyboard input
  useInput(
    (input, key) => {
      // Navigation
      if (handleNavigation(input, key)) {
        return
      }

      // Selection
      if (key.return) {
        selectCurrent()
        return
      }

      // Cancel
      if (key.escape && !hideCancelButton) {
        onCancel?.()
        return
      }

      // Backspace for search
      if (key.backspace || key.delete) {
        setSearchValue((prev) => prev.slice(0, -1))
        return
      }

      // Custom keybinds
      if (handleCustomKeybinds(input)) {
        return
      }

      // Type to search (printable characters)
      if (input && input.length === 1 && !key.ctrl && !key.meta) {
        setSearchValue((prev) => prev + input)
      }
    },
    {isActive},
  )

  // Calculate visible window
  const {visibleGroups, windowStart} = useMemo(() => {
    if (flatItems.length === 0) {
      return {visibleGroups: groupedItems, windowStart: 0}
    }

    // Calculate how many items fit
    const maxItems = Math.max(1, availableHeight - 4) // Reserve space for title, search, keybinds

    // Center the selected item in the window
    const halfWindow = Math.floor(maxItems / 2)
    let start = selectedIndex - halfWindow
    start = Math.max(0, start)
    start = Math.min(start, Math.max(0, flatItems.length - maxItems))

    const visibleItemKeys = new Set(flatItems.slice(start, start + maxItems).map((item) => keyExtractor(item)))

    // Filter groups to only include visible items
    const visible = groupedItems
      .map((g) => ({
        group: g.group,
        items: g.items.filter((item) => visibleItemKeys.has(keyExtractor(item))),
      }))
      .filter((g) => g.items.length > 0)

    return {visibleGroups: visible, windowStart: start}
  }, [groupedItems, flatItems, selectedIndex, availableHeight, keyExtractor])

  const hasMoreAbove = windowStart > 0
  const hasMoreBelow = windowStart + (availableHeight - 4) < flatItems.length

  // Get the key of the current item for comparison
  const currentKey = currentItem && getCurrentKey ? getCurrentKey(currentItem) : undefined

  return (
    <Box borderColor={colors.border} borderStyle="single" flexDirection="column" paddingX={1}>
      {/* Title */}
      {title && (
        <Box marginBottom={1}>
          <Text bold color={colors.text}>
            {title}
          </Text>
        </Box>
      )}

      {/* Search input */}
      <Box marginBottom={1}>
        <Text color={colors.dimText}>🔍 </Text>
        <Text color={searchValue ? colors.text : colors.dimText}>{searchValue || searchPlaceholder}</Text>
        <Text color={colors.primary}>▎</Text>
      </Box>

      {/* More above indicator */}
      {hasMoreAbove && (
        <Box justifyContent="center">
          <Text color={colors.dimText}>↑ {windowStart} more above</Text>
        </Box>
      )}

      {/* Items */}
      {flatItems.length === 0 ? (
        <Box paddingY={1}>
          <Text color={colors.dimText}>No items found</Text>
        </Box>
      ) : (
        visibleGroups.map((group) => (
          <Box flexDirection="column" key={group.group || '__ungrouped__'}>
            {/* Group header */}
            {group.group && (
              <Box marginTop={1}>
                <Text bold color={colors.primary}>
                  ── {group.group} ──
                </Text>
              </Box>
            )}

            {/* Group items */}
            {group.items.map((item) => {
              const key = keyExtractor(item)
              const flatIndex = flatItems.findIndex((i) => keyExtractor(i) === key)
              const isActive = flatIndex === selectedIndex
              const isCurrent = currentKey !== undefined && getCurrentKey?.(item) === currentKey

              return (
                <Box key={key}>
                  {/* Current indicator */}
                  <Text color={isActive ? colors.primary : colors.text}>{isCurrent ? '● ' : '  '}</Text>
                  {/* Selection indicator */}
                  <Text
                    backgroundColor={isActive ? colors.dimText : undefined}
                    color={isActive ? colors.text : colors.text}
                  >
                    {isActive ? '❯ ' : '  '}
                  </Text>
                  {/* Item content */}
                  {renderItem(item, isActive, isCurrent)}
                </Box>
              )
            })}
          </Box>
        ))
      )}

      {/* More below indicator */}
      {hasMoreBelow && (
        <Box justifyContent="center">
          <Text color={colors.dimText}>↓ {flatItems.length - windowStart - (availableHeight - 4)} more below</Text>
        </Box>
      )}

      {/* Keybind hints */}
      <Box gap={2} marginTop={1}>
        <Text color={colors.dimText}>
          <Text color={colors.text}>↑↓</Text> Navigate
        </Text>
        <Text color={colors.dimText}>
          <Text color={colors.text}>Enter</Text> Select
        </Text>
        {!hideCancelButton && (
          <Text color={colors.dimText}>
            <Text color={colors.text}>Esc</Text> Cancel
          </Text>
        )}
        {keybinds.map((kb) => (
          <Text color={colors.dimText} key={kb.key}>
            <Text color={colors.text}>{kb.key}</Text> {kb.label}
          </Text>
        ))}
      </Box>
    </Box>
  )
}
