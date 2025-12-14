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

import type {CommandArg, CommandFlag, CommandSubcommandInfo} from '../types.js'

import {useMode} from '../contexts/use-mode.js'
import {useTheme} from '../contexts/use-theme.js'
import {useSlashCompletion} from '../hooks/index.js'

const MAX_VISIBLE_ITEMS = 5

interface SuggestionsProps {
  input: string
  onInsert?: (value: string) => void
  onSelect?: (value: string) => void
}

/**
 * Format usage string from args, flags, and subcommands
 */
function formatUsage(
  label: string,
  args?: CommandArg[],
  flags?: CommandFlag[],
  subCommands?: CommandSubcommandInfo[],
): string {
  let usage = label

  if (subCommands?.length) {
    usage += ' <subcommand>'
  }

  if (args?.length) {
    const argsStr = args.map((a) => (a.required ? `<${a.name}>` : `[${a.name}]`)).join(' ')
    usage += ` ${argsStr}`
  }

  if (flags?.length) {
    const flagsStr = flags.map((f) => `[--${f.name}]`).join(' ')
    usage += ` ${flagsStr}`
  }

  return usage
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

  // Calculate visible window based on selected index
  const {visibleSuggestions, windowStart} = useMemo(() => {
    if (suggestions.length <= MAX_VISIBLE_ITEMS) {
      return {visibleSuggestions: suggestions, windowStart: 0}
    }

    // Calculate window start to keep selected item visible
    let start = 0
    if (activeIndex >= MAX_VISIBLE_ITEMS) {
      start = activeIndex - MAX_VISIBLE_ITEMS + 1
    }

    // Ensure we don't go past the end
    const maxStart = suggestions.length - MAX_VISIBLE_ITEMS
    start = Math.min(start, maxStart)

    return {
      visibleSuggestions: suggestions.slice(start, start + MAX_VISIBLE_ITEMS),
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
  const hasDetails =
    selectedSuggestion &&
    (selectedSuggestion.args?.length || selectedSuggestion.flags?.length || selectedSuggestion.subCommands?.length)

  // Calculate if there are more items above/below
  const hasMoreAbove = windowStart > 0
  const hasMoreBelow = windowStart + MAX_VISIBLE_ITEMS < suggestions.length

  return (
    <Box borderColor={colors.border} borderStyle="single" flexDirection="column" paddingX={1}>
      {hasMoreAbove && (
        <Text color={colors.dimText} dimColor>
          ↑ {windowStart} more above
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
            <Text color={colors.dimText}> {suggestion.description || ''}</Text>
          </Box>
        )
      })}

      {hasMoreBelow && (
        <Text color={colors.dimText} dimColor>
          ↓ {suggestions.length - windowStart - MAX_VISIBLE_ITEMS} more below
        </Text>
      )}

      {/* Show args/flags/subcommands for selected command */}
      {hasDetails && (
        <Box borderColor={colors.border} borderStyle="single" borderTop flexDirection="column" marginTop={0}>
          <Text color={colors.text}>
            Usage:{' '}
            {formatUsage(
              selectedSuggestion.label,
              selectedSuggestion.args,
              selectedSuggestion.flags,
              selectedSuggestion.subCommands,
            )}
          </Text>

          {selectedSuggestion.subCommands?.map((sub) => (
            <Text color={colors.dimText} key={sub.name}>
              {'  '}
              <Text color={colors.text}>{sub.name.padEnd(labelWidth + 2)}</Text>
              {'  '}
              {sub.description}
            </Text>
          ))}

          {selectedSuggestion.args?.map((arg) => (
            <Text color={colors.dimText} key={arg.name}>
              {'  '}
              <Text color={colors.text}>{arg.required ? `<${arg.name}>` : `[${arg.name}]`}</Text>
              {'  '}
              {arg.description}
            </Text>
          ))}

          {selectedSuggestion.flags?.map((flag) => (
            <Text color={colors.dimText} key={flag.name}>
              {'  '}
              <Text color={colors.text}>
                {flag.char ? `-${flag.char}, ` : '    '}--{flag.name}
              </Text>
              {'  '}
              {flag.description}
              {flag.default !== undefined && <Text> (default: {String(flag.default)})</Text>}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  )
}
