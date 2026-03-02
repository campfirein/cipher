/**
 * InlineFileSelector Component
 *
 * Tree-view file/directory selector similar to inquirer-file-selector.
 *
 * Two modes:
 * - 'file': Select files only, folders are for navigation
 * - 'directory': Select and list folders only
 *
 * Navigation:
 * - Up/Down arrows: Move selection
 * - Right arrow: Navigate into folder
 * - Enter: Select current item (only works when item matches mode)
 * - Left arrow/Backspace: Go up one directory level
 * - Escape: Cancel selection (if allowCancel is true)
 *
 * Features:
 * - Path breadcrumb showing current location
 * - Sliding window for long lists
 * - Filter support
 * - Cannot navigate above basePath
 */

import {Box, Text, useInput} from 'ink'
import fs from 'node:fs'
import path from 'node:path'
import React, {useEffect, useMemo, useState} from 'react'

import type {FileSelectorItemResult} from '../../types/index.js'

import {useTheme} from '../../hooks/index.js'

const DEFAULT_PAGE_SIZE = 7

/** Selection mode for the file selector */
export type FileSelectorMode = 'directory' | 'file'

export interface InlineFileSelectorProps {
  /** Allow user to cancel selection */
  allowCancel?: boolean
  /** Base path to start from (cannot navigate above this) */
  basePath: string
  /** Filter function to show/hide items (applied after mode filter) */
  filter?: (item: FileSelectorItemResult) => boolean
  /** The prompt message */
  message: string
  /** Selection mode: 'file' or 'directory' (default: 'file') */
  mode?: FileSelectorMode
  /** Callback when user selects or cancels */
  onSelect: (item: FileSelectorItemResult | null) => void
  /** Number of items visible at once */
  pageSize?: number
}

export function InlineFileSelector({
  allowCancel = false,
  basePath,
  filter,
  message,
  mode = 'file',
  onSelect,
  pageSize = DEFAULT_PAGE_SIZE,
}: InlineFileSelectorProps): React.ReactElement {
  const {
    theme: {colors},
  } = useTheme()
  const [currentPath, setCurrentPath] = useState(basePath)
  const [items, setItems] = useState<FileSelectorItemResult[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [windowStart, setWindowStart] = useState(0)
  const [isLoading, setIsLoading] = useState(true)

  // Normalize paths for comparison
  const normalizedBasePath = useMemo(() => path.resolve(basePath), [basePath])
  const normalizedCurrentPath = useMemo(() => path.resolve(currentPath), [currentPath])

  // Check if we can go up (not at basePath)
  const canGoUp = normalizedCurrentPath !== normalizedBasePath

  // Load directory contents
  useEffect(() => {
    const loadItems = async () => {
      setIsLoading(true)
      try {
        const entries = fs.readdirSync(currentPath, {withFileTypes: true})
        let fileItems: FileSelectorItemResult[] = entries.map((entry) => ({
          isDirectory: entry.isDirectory(),
          name: entry.name,
          path: path.join(currentPath, entry.name),
        }))

        // In directory mode, only show directories
        if (mode === 'directory') {
          fileItems = fileItems.filter((item) => item.isDirectory)
        }

        // Apply custom filter
        if (filter) {
          fileItems = fileItems.filter((item) => filter(item))
        }

        // Sort: directories first, then alphabetically
        fileItems.sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) {
            return a.isDirectory ? -1 : 1
          }

          return a.name.localeCompare(b.name)
        })

        // Add "." for selecting current folder (in directory mode)
        if (mode === 'directory') {
          fileItems.unshift({
            isDirectory: true,
            name: '.',
            path: currentPath,
          })
        }

        setItems(fileItems)
        setSelectedIndex(0)
        setWindowStart(0)
      } catch {
        // Handle permission errors or other issues
        setItems([])
      } finally {
        setIsLoading(false)
      }
    }

    loadItems()
  }, [currentPath, filter, mode])

  // Calculate visible items (sliding window)
  const visibleItems = useMemo(() => items.slice(windowStart, windowStart + pageSize), [items, windowStart, pageSize])

  // Check if selected item can be selected based on mode
  const canSelectItem = (item: FileSelectorItemResult | undefined): boolean => {
    if (!item) return false
    if (mode === 'file') return !item.isDirectory
    if (mode === 'directory') return item.isDirectory
    return false
  }

  // Handle Enter key selection
  const handleEnterKey = () => {
    const selected = items[selectedIndex]

    // In directory mode with empty folder, select current path
    if (mode === 'directory' && items.length === 0) {
      onSelect({
        isDirectory: true,
        name: path.basename(currentPath),
        path: currentPath,
      })
      return
    }

    // Select current folder on "." selection (directory mode)
    if (selected?.name === '.' && mode === 'directory') {
      onSelect(selected)
      return
    }

    // Navigate into folder (same as right arrow)
    if (selected?.isDirectory) {
      setCurrentPath(selected.path)
      return
    }

    // Select file (in file mode)
    if (canSelectItem(selected)) {
      onSelect(selected)
    }
  }

  // Handle keyboard input
  useInput((_input, key) => {
    if (key.upArrow) {
      setSelectedIndex((prev) => {
        const newIndex = Math.max(0, prev - 1)
        // Adjust window if selection goes above visible area
        if (newIndex < windowStart) {
          setWindowStart(newIndex)
        }

        return newIndex
      })
    } else if (key.downArrow) {
      setSelectedIndex((prev) => {
        const newIndex = Math.min(items.length - 1, prev + 1)
        // Adjust window if selection goes below visible area
        if (newIndex >= windowStart + pageSize) {
          setWindowStart(newIndex - pageSize + 1)
        }

        return newIndex
      })
    } else if (key.rightArrow) {
      // Navigate into directory
      const selected = items[selectedIndex]
      if (selected?.isDirectory && selected.name !== '.') {
        setCurrentPath(selected.path)
      }
    } else if (key.return) {
      handleEnterKey()
    } else if (key.backspace || key.leftArrow) {
      // Go up one level (if not at basePath)
      if (canGoUp) {
        setCurrentPath(path.dirname(currentPath))
      }
    } else if (key.escape && allowCancel) {
      onSelect(null)
    }
  })

  // Get relative path for display
  const displayPath = normalizedCurrentPath.replace(process.cwd(), '') || '.'

  return (
    <Box flexDirection="column">
      {/* Message */}
      <Text bold color={colors.text}>
        <Text color={colors.secondary}>? </Text>
        {message}
      </Text>

      {/* Current path breadcrumb */}
      <Text color={colors.primary}>{displayPath}</Text>

      {/* Items list */}
      <Box
        borderBottom={false}
        borderColor={colors.border}
        borderLeft={false}
        borderRight={false}
        borderStyle="single"
        borderTop={true}
        flexDirection="column"
      >
        {isLoading ? (
          <Text color={colors.dimText}>Loading...</Text>
        ) : visibleItems.length === 0 ? (
          <Text color={colors.warning}>
            {mode === 'directory' ? '(empty folder) Press Enter to select this location' : '(no files)'}
          </Text>
        ) : (
          visibleItems.map((item, index) => {
            const actualIndex = windowStart + index
            const isSelected = actualIndex === selectedIndex
            const icon = index === visibleItems.length - 1 ? '└──' : '├──'
            const suffix = item.isDirectory && item.name !== '.' ? '/' : ''
            const isSelectable = canSelectItem(item) || item.name === '.'

            // Dim items that can't be selected (except "." for folder selection)
            const itemColor = isSelected ? colors.primary : isSelectable ? colors.text : colors.dimText

            // Display label for "."
            const displayName = item.name === '.' ? '. (select this folder)' : item.name

            return (
              <Text color={itemColor} key={item.path}>
                {isSelected ? '❯ ' : '  '}
                {icon} {displayName}
                {suffix}
              </Text>
            )
          })
        )}
      </Box>

      {/* Scroll indicator if there are more items */}
      {items.length > pageSize && (
        <Text color={colors.dimText} dimColor>
          {windowStart > 0 ? '↑ ' : '  '}
          {selectedIndex + 1}/{items.length}
          {windowStart + pageSize < items.length ? ' ↓' : '  '}
        </Text>
      )}

      {/* Hint line */}
      <Text dimColor>
        {'[↑↓] navigate  [→] open  [←] up  [Enter] select'}
        {mode === 'file' ? ' file' : ' folder'}
        {allowCancel ? '  [Esc] cancel' : ''}
      </Text>
    </Box>
  )
}
