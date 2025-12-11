/**
 * Command kind indicates the source/type of command
 * Based on Gemini CLI pattern for extensibility
 */
export enum CommandKind {
  /** Built-in commands defined in code */
  BUILT_IN = 'built-in',
  /** Future: file-based commands */
  FILE = 'file',
  /** Commands that dispatch to oclif CLI commands */
  OCLIF = 'oclif',
}

/**
 * Suggestion item for auto-completion
 */
export interface CommandSuggestion {
  /** Command kind for styling */
  commandKind?: CommandKind
  /** Optional description */
  description?: string
  /** Display label */
  label: string
  /** Value to insert on selection */
  value: string
}

/**
 * Suggestions Component
 *
 * Displays command suggestions with auto-completion.
 * Uses useSlashCompletion hook internally to manage state.
 */

import { Box, Text, useInput } from 'ink'
import React, { useEffect } from 'react'

import { useMode } from '../contexts/use-mode.js'
import { useTheme } from '../contexts/use-theme.js'
import { useSlashCompletion } from '../hooks/index.js'

interface SuggestionsProps {
  input: string
  onInsert?: (value: string) => void
  onSelect?: (value: string) => void
}

export const Suggestions: React.FC<SuggestionsProps> = ({ input, onInsert, onSelect }) => {
  const { theme: { colors } } = useTheme()
  const { mode, setMode } = useMode()
  const {
    activeIndex,
    clearSuggestions,
    nextSuggestion,
    prevSuggestion,
    selectSuggestion,
    suggestions,
  } = useSlashCompletion(input)

  // Manage mode based on suggestions visibility
  useEffect(() => {
    if (suggestions.length > 0) {
      setMode('suggestions')
    } else {
      setMode('console')
    }
  }, [suggestions.length, setMode])

  useInput((_input, key) => {
    if (key.upArrow) prevSuggestion()

    if (key.downArrow) nextSuggestion()

    if (key.return) {
      const value = selectSuggestion()
      if (value && onSelect) {
        onSelect(value)
      }

      clearSuggestions()
      setMode('console')
    }

    if (key.tab) {
      const value = selectSuggestion()
      if (value && onInsert) {
        onInsert(value)
      }

      clearSuggestions()
      setMode('console')
    }

    if (key.escape) {
      clearSuggestions()
      setMode('console')
    }
  }, { isActive: mode === 'suggestions' })

  if (suggestions.length === 0) {
    return null
  }

  // Calculate max label width for alignment
  const maxLabelLength = Math.max(...suggestions.map((s) => s.label.length))
  const labelWidth = Math.max(maxLabelLength, 12)

  return (
    <Box borderColor={colors.primary} borderStyle="single" flexDirection="column" paddingX={1}>
      {suggestions.slice(0, 8).map((suggestion, index) => {
        const isActive = index === activeIndex
        return (
          <Box key={suggestion.value}>
            <Text
              backgroundColor={isActive ? colors.primary : undefined}
              color={colors.text}
            >
              {isActive ? '› ' : '  '}
              {suggestion.label.padEnd(labelWidth)}
            </Text>
            <Text color={colors.dimText}> {suggestion.description || ''}</Text>
          </Box>
        )
      })}

      {/* Show count if there are more suggestions */}
      {suggestions.length > 8 && (
        <Text color={colors.dimText} dimColor>
          ... and {suggestions.length - 8} more
        </Text>
      )}
    </Box>
  )
}
