import fs from 'node:fs'
import path from 'node:path'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'

import type {CommandSuggestion, SlashCommand} from '../types.js'

import {useCommands} from '../contexts/use-commands.js'

/**
 * Generate file suggestions based on @ prefix
 * Returns files from the current working directory matching the search pattern
 */
function generateFileSuggestions(searchPattern: string): CommandSuggestion[] {
  try {
    const cwd = process.cwd()

    // If pattern ends with /, list contents of that directory
    let searchDir: string
    let searchPrefix: string

    if (searchPattern.endsWith('/')) {
      searchDir = searchPattern.slice(0, -1) || '.'
      searchPrefix = ''
    } else {
      searchDir = path.dirname(searchPattern) || '.'
      searchPrefix = path.basename(searchPattern).toLowerCase()
    }

    const fullSearchDir = path.resolve(cwd, searchDir)

    // Check if search directory exists and is within cwd
    if (!fs.existsSync(fullSearchDir) || !fullSearchDir.startsWith(cwd)) {
      return []
    }

    const entries = fs.readdirSync(fullSearchDir, {withFileTypes: true})
    const suggestions: CommandSuggestion[] = []

    for (const entry of entries) {
      // Skip hidden files
      if (entry.name.startsWith('.')) continue

      const name = entry.name.toLowerCase()
      if (!searchPrefix || name.startsWith(searchPrefix)) {
        const relativePath = searchDir === '.' ? entry.name : path.join(searchDir, entry.name)
        const isDir = entry.isDirectory()

        suggestions.push({
          description: isDir ? 'folder' : '',
          label: `${relativePath}${isDir ? '/' : ''}`,
          value: `@${relativePath}${isDir ? '/' : ''}`,
        })
      }
    }

    // Sort: directories first, then alphabetically
    suggestions.sort((a, b) => {
      const aIsDir = a.description === 'folder'
      const bIsDir = b.description === 'folder'
      if (aIsDir !== bIsDir) return aIsDir ? -1 : 1
      return a.label.localeCompare(b.label)
    })

    return suggestions.slice(0, 20) // Limit to 20 suggestions
  } catch {
    return []
  }
}

/**
 * Hook return type
 */
interface UseSlashCompletionReturn {
  /** Index of currently active suggestion (-1 if none) */
  activeIndex: number
  /** Clear suggestions */
  clearSuggestions: () => void
  /** Whether the input matches a known command (even if typing arguments) */
  hasMatchedCommand: boolean
  /** Whether input is a slash command attempt (starts with /) */
  isCommandAttempt: boolean
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
function generateSuggestions(input: string, commands: readonly SlashCommand[]): CommandSuggestion[] {
  const trimmed = input.trim()

  // Check for @ file completion (last word starts with @)
  // Don't show file suggestions if input ends with space (file already selected)
  if (!input.endsWith(' ')) {
    const lastAtMatch = trimmed.match(/@([^\s@]*)$/)
    if (lastAtMatch) {
      const searchPattern = lastAtMatch[1]
      const suggestions = generateFileSuggestions(searchPattern)

      // Filter out already selected files
      const existingFiles = new Set(
        [...trimmed.matchAll(/@([^\s@]+)/g)].map((m) => m[1]),
      )
      return suggestions.filter((s) => {
        const filePath = s.value.slice(1) // Remove @ prefix
        return !existingFiles.has(filePath)
      })
    }
  }

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

    return matchingCommands.map((cmd) => ({
      args: cmd.args,
      commandKind: cmd.kind,
      description: cmd.description,
      flags: cmd.flags,
      label: `/${cmd.name}`,
      subCommands: cmd.subCommands
        ?.filter((sub) => !sub.hidden)
        .map((sub) => ({
          description: sub.description,
          name: sub.name,
        })),
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

    return matchingSubCommands.map((sub) => ({
      args: sub.args,
      commandKind: sub.kind,
      description: sub.description,
      flags: sub.flags,
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
export function useSlashCompletion(input: string): UseSlashCompletionReturn {
  const {commands} = useCommands()
  const [activeIndex, setActiveIndex] = useState(-1)

  // Check if input is a command attempt (starts with /)
  const isCommandAttempt = input.trim().startsWith('/')

  // Check if we're in file completion mode (has @ and not ending with space)
  const isFileCompletion = useMemo(
    () => !input.endsWith(' ') && /@[^\s@]*$/.test(input.trim()),
    [input],
  )

  // Check if the input matches a known command (for when typing arguments)
  const hasMatchedCommand = useMemo(() => {
    // File completion counts as "matched" to avoid showing "no commands found"
    if (isFileCompletion) return true
    if (!isCommandAttempt) return false
    const trimmed = input.trim()
    const withoutSlash = trimmed.slice(1)
    const parts = withoutSlash.split(/\s+/)
    const commandPart = parts[0]?.toLowerCase() ?? ''
    return commands.some((cmd) => cmd.name === commandPart || cmd.aliases?.includes(commandPart))
  }, [commands, input, isCommandAttempt, isFileCompletion])

  // Generate suggestions based on current input
  const suggestions = useMemo(() => generateSuggestions(input, commands), [commands, input])

  // Use refs to avoid stale closures
  const activeIndexRef = useRef(activeIndex)
  const suggestionsRef = useRef(suggestions)
  const inputRef = useRef(input)
  const isFileCompletionRef = useRef(isFileCompletion)

  // Keep refs in sync
  activeIndexRef.current = activeIndex
  suggestionsRef.current = suggestions
  inputRef.current = input
  isFileCompletionRef.current = isFileCompletion

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

    const selectedValue = currentSuggestions[currentIndex].value

    // For file completion, replace the @... part with the selected file
    if (isFileCompletionRef.current) {
      const currentInput = inputRef.current
      // Replace the @... at the end with the selected file path
      return currentInput.replace(/@[^\s@]*$/, selectedValue)
    }

    return selectedValue
  }, [])

  const clearSuggestions = useCallback(() => {
    setActiveIndex(-1)
    activeIndexRef.current = -1
  }, [])

  return {
    activeIndex,
    clearSuggestions,
    hasMatchedCommand,
    isCommandAttempt,
    nextSuggestion,
    prevSuggestion,
    selectSuggestion,
    setActiveIndex,
    suggestions,
  }
}
