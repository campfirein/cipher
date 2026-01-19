/**
 * Suggestions Component
 *
 * Displays command suggestions with auto-completion.
 * Uses useSlashCompletion hook internally to manage state.
 * Shows args/flags details for the selected command.
 * Shows max 7 items with sliding window that follows selection.
 */

import {Box, Text, useInput} from 'ink'
import React, {useEffect, useMemo, useRef} from 'react'

import {useMode} from '../contexts/mode-context.js'
import {useTheme} from '../contexts/theme-context.js'
import {useSlashCompletion} from '../hooks/index.js'
import {CommandDetails} from './command-details.js'

const MAX_VISIBLE_ITEMS = 5

interface SuggestionsProps {
  input: string
  onInsert?: (value: string) => void
  onSelect?: (value: string) => void
}

export const Suggestions: React.FC<SuggestionsProps> = ({input, onInsert, onSelect}) => {
  const {
    theme: {colors},
  } = useTheme()
  const {mode, setMode} = useMode()
  const {
    activeIndex,
    clearSuggestions,
    hasMatchedCommand,
    isCommandAttempt,
    nextSuggestion,
    prevSuggestion,
    selectSuggestion,
    suggestions,
  } = useSlashCompletion(input)

  // Track if user dismissed suggestions with Escape
  const isDismissedRef = useRef(false)
  const prevInputRef = useRef(input)

  // Reset dismissed state when input changes
  useEffect(() => {
    if (input !== prevInputRef.current) {
      isDismissedRef.current = false
      prevInputRef.current = input
    }
  }, [input])

  // Manage mode based on suggestions visibility
  // Don't show suggestions mode when user is typing arguments for a matched command
  // Don't re-enable if user dismissed with Escape
  // Only control mode when already in console/suggestions mode (don't override 'activity')
  useEffect(() => {
    if (isDismissedRef.current) {
      return
    }

    // Only manage mode transitions within console/suggestions context
    if (mode !== 'console' && mode !== 'suggestions') {
      return
    }

    if (suggestions.length > 0 || (isCommandAttempt && !hasMatchedCommand)) {
      setMode('suggestions')
    } else {
      setMode('console')
    }
  }, [mode, suggestions.length, isCommandAttempt, hasMatchedCommand, setMode])

  // - No indicators: 5 items
  // - One indicator (top OR bottom): 4 items + 1 indicator
  // - Both indicators: 3 items + 2 indicators
  const {visibleSuggestions, windowStart} = useMemo(() => {
    const totalItems = suggestions.length
    const totalHeight = MAX_VISIBLE_ITEMS // 5 lines total

    // All items fit, no indicators needed
    if (totalItems <= totalHeight) {
      return {visibleSuggestions: suggestions, windowStart: 0}
    }

    let maxVisibleItems: number
    let start: number

    // Near start: no top indicator needed
    if (activeIndex < 3) {
      maxVisibleItems = totalHeight - 1 // 4 items + bottom indicator
      start = 0
    }
    // Near end: no bottom indicator needed
    else if (activeIndex >= totalItems - 3) {
      maxVisibleItems = totalHeight - 1 // top indicator + 4 items
      start = Math.max(0, totalItems - maxVisibleItems)
    }
    // Middle: both indicators needed
    else {
      maxVisibleItems = totalHeight - 2 // top indicator + 3 items + bottom indicator
      // Try to center activeIndex in the viewport
      const centerOffset = Math.floor(maxVisibleItems / 2)
      start = activeIndex - centerOffset
      // Adjust if we went past the end
      const maxStart = totalItems - maxVisibleItems
      start = Math.min(start, maxStart)
    }

    return {
      visibleSuggestions: suggestions.slice(start, start + maxVisibleItems),
      windowStart: start,
    }
  }, [suggestions, activeIndex])

  useInput(
    (_input, key) => {
      if (key.upArrow) {
        prevSuggestion()
      }

      if (key.downArrow) {
        nextSuggestion()
      }

      if (key.return) {
        const value = selectSuggestion()
        if (value) {
          // In file completion mode (value contains @)
          const isFileCompletion = value.includes('@')
          const isFolder = value.endsWith('/')

          if (isFileCompletion && onInsert) {
            onInsert(value)
            // For folders, stay in suggestions mode to show contents
            if (isFolder) {
              clearSuggestions()
              // Don't exit suggestions mode - new suggestions will appear
              return
            }
          } else if (onSelect) {
            onSelect(value)
          }
        }

        clearSuggestions()
        setMode('console')
      }

      if (key.tab) {
        const value = selectSuggestion()
        if (value && onInsert) {
          onInsert(value)
          // For folders, stay in suggestions mode
          if (value.endsWith('/')) {
            clearSuggestions()
            return
          }
        }

        clearSuggestions()
        setMode('console')
      }

      if (key.escape) {
        isDismissedRef.current = true
        clearSuggestions()
        setMode('console')
      }
    },
    {isActive: mode === 'suggestions'},
  )

  // Don't render if dismissed
  if (isDismissedRef.current) {
    return null
  }

  // Show "No commands found" when typing an unknown command
  // Don't show when user is typing arguments for a known command
  if (suggestions.length === 0) {
    if (isCommandAttempt && !hasMatchedCommand && input.trim().length > 1) {
      return (
        <Box borderColor={colors.border} borderStyle="single" paddingX={1}>
          <Text color={colors.dimText}>No commands found</Text>
        </Box>
      )
    }

    return null
  }

  // Calculate max label width for alignment
  const maxLabelLength = Math.max(...suggestions.map((s) => s.label.length))
  const labelWidth = Math.max(maxLabelLength, 12)

  // Get the selected suggestion
  const selectedSuggestion = activeIndex >= 0 ? suggestions[activeIndex] : null

  // Calculate if there are more items above/below
  const hasMoreAbove = windowStart > 0
  const hasMoreBelow = windowStart + visibleSuggestions.length < suggestions.length

  return (
    <Box borderColor={colors.border} borderStyle="single" columnGap={1} paddingX={1}>
      <Box flexDirection='column' flexShrink={0}>
        {hasMoreAbove && (
          <Text color={colors.dimText} dimColor>
            ↑ {windowStart} more
          </Text>
        )}

        {visibleSuggestions.map((suggestion, index) => {
          const actualIndex = windowStart + index
          const isActive = actualIndex === activeIndex
          return (
            <Box key={suggestion.value}>
              <Text backgroundColor={isActive ? colors.dimText : undefined} color={colors.text}>
                {isActive ? '❯ ' : '  '}
                {suggestion.label.padEnd(labelWidth)}
              </Text>
            </Box>
          )
        })}

        {hasMoreBelow && (
          <Text color={colors.dimText} dimColor>
            ↓ {suggestions.length - windowStart - visibleSuggestions.length} more
          </Text>
        )}
      </Box>
      <CommandDetails labelWidth={labelWidth} selectedSuggestion={selectedSuggestion} />
    </Box>
  )
}
