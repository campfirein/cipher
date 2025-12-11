import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { CommandSuggestion, SlashCommand } from '../types.js'

import { useCommands } from '../contexts/use-commands.js'

/**
 * Maximum number of suggestions to display
 */
const MAX_SUGGESTIONS = 8

/**
 * Hook return type
 */
interface UseSlashCompletionReturn {
  /** Index of currently active suggestion (-1 if none) */
  activeIndex: number
  /** Clear suggestions */
  clearSuggestions: () => void
  /** Move to next suggestion */
  nextSuggestion: () => void
  /** Move to previous suggestion */
  prevSuggestion: () => void
  /** Select the current suggestion and return the value to insert */
  selectSuggestion: () => null | string
  /** Set active index directly */
  setActiveIndex: (index: number) => void
  /** Current suggestions */
  suggestions: CommandSuggestion[]
}

/**
 * Generate command suggestions based on current input
 */
function generateSuggestions(
  input: string,
  commands: readonly SlashCommand[],
): CommandSuggestion[] {
  const trimmed = input.trim()

  // Only suggest for slash command inputs
  if (!trimmed.startsWith('/')) {
    return []
  }

  const withoutSlash = trimmed.slice(1)
  const parts = withoutSlash.split(/\s+/)
  const commandPart = parts[0]?.toLowerCase() ?? ''

  // If we're still typing the command name (no space after it)
  if (parts.length === 1) {
    // Filter commands that start with the typed prefix
    const matchingCommands = commands
      .filter((cmd) => !cmd.hidden)
      .filter((cmd) => {
        const nameMatch = cmd.name.toLowerCase().startsWith(commandPart)
        const aliasMatch = cmd.aliases?.some((alias) => alias.toLowerCase().startsWith(commandPart))
        return nameMatch || aliasMatch
      })
      .slice(0, MAX_SUGGESTIONS)

    return matchingCommands.map((cmd) => ({
      commandKind: cmd.kind,
      description: cmd.description,
      label: `/${cmd.name}`,
      value: `/${cmd.name}`,
    }))
  }

  // Find the matched command
  const command = commands.find((cmd) => cmd.name === commandPart || cmd.aliases?.includes(commandPart))

  if (!command) {
    return []
  }

  // If command has subcommands, suggest them
  if (command.subCommands?.length && parts.length === 2) {
    const subPart = parts[1]?.toLowerCase() ?? ''
    const matchingSubCommands = command.subCommands
      .filter((sub) => !sub.hidden)
      .filter((sub) => {
        const nameMatch = sub.name.toLowerCase().startsWith(subPart)
        const aliasMatch = sub.aliases?.some((alias) => alias.toLowerCase().startsWith(subPart))
        return nameMatch || aliasMatch
      })
      .slice(0, MAX_SUGGESTIONS)

    return matchingSubCommands.map((sub) => ({
      commandKind: sub.kind,
      description: sub.description,
      label: `/${command.name} ${sub.name}`,
      value: `/${command.name} ${sub.name}`,
    }))
  }

  // Future enhancement: use command.completion for argument suggestions
  return []
}

/**
 * Hook for slash command auto-completion
 * Generates suggestions based on input and manages selection state
 */
export function useSlashCompletion(
  input: string,
): UseSlashCompletionReturn {
  const { commands } = useCommands()
  const [activeIndex, setActiveIndex] = useState(-1)

  // Generate suggestions based on current input
  const suggestions = useMemo(
    () => generateSuggestions(input, commands),
    [commands, input],
  )

  // Use refs to avoid stale closures
  const activeIndexRef = useRef(activeIndex)
  const suggestionsRef = useRef(suggestions)

  // Keep refs in sync
  activeIndexRef.current = activeIndex
  suggestionsRef.current = suggestions

  // Reset active index when suggestions change
  useEffect(() => {
    const newIndex = suggestions.length > 0 ? 0 : -1
    setActiveIndex(newIndex)
    activeIndexRef.current = newIndex
  }, [suggestions])

  const nextSuggestion = useCallback(() => {
    const currentSuggestions = suggestionsRef.current
    if (currentSuggestions.length === 0) return
    setActiveIndex((prev) => {
      const newIndex = (prev + 1) % currentSuggestions.length
      activeIndexRef.current = newIndex
      return newIndex
    })
  }, [])

  const prevSuggestion = useCallback(() => {
    const currentSuggestions = suggestionsRef.current
    if (currentSuggestions.length === 0) return
    setActiveIndex((prev) => {
      const newIndex = (prev - 1 + currentSuggestions.length) % currentSuggestions.length
      activeIndexRef.current = newIndex
      return newIndex
    })
  }, [])

  const selectSuggestion = useCallback((): null | string => {
    const currentIndex = activeIndexRef.current
    const currentSuggestions = suggestionsRef.current

    if (currentIndex < 0 || currentIndex >= currentSuggestions.length) {
      return null
    }

    return currentSuggestions[currentIndex].value
  }, [])

  const clearSuggestions = useCallback(() => {
    setActiveIndex(-1)
    activeIndexRef.current = -1
  }, [])

  return {
    activeIndex,
    clearSuggestions,
    nextSuggestion,
    prevSuggestion,
    selectSuggestion,
    setActiveIndex,
    suggestions,
  }
}
