/**
 * InlineSearch Component
 *
 * Generic inline searchable selection prompt.
 * Renders a search input with filterable list of options.
 * Shows max 7 items with a sliding window that follows selection.
 */

import {Box, Text, useInput} from 'ink'
import TextInput from 'ink-text-input'
import React, {useEffect, useState} from 'react'

import type {PromptChoice} from '../../types.js'

import {useTheme, useVisibleWindow} from '../../hooks/index.js'

const MAX_VISIBLE_ITEMS = 7

export interface InlineSearchProps<T = unknown> {
  /** Maximum number of visible items in the dropdown (default: 7) */
  maxVisibleItems?: number
  /** The prompt message */
  message: string
  /** Callback when user selects a value */
  onSelect: (value: T) => void
  /** Function that returns choices based on search input */
  source: (input: string | undefined) => Array<PromptChoice<T>> | Promise<Array<PromptChoice<T>>>
}

export function InlineSearch<T>({maxVisibleItems = MAX_VISIBLE_ITEMS, message, onSelect, source}: InlineSearchProps<T>): React.ReactElement {
  const {
    theme: {colors},
  } = useTheme()
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [choices, setChoices] = useState<Array<PromptChoice<T>>>([])

  // Load choices based on search query
  useEffect(() => {
    const loadChoices = async () => {
      const result = source(searchQuery || undefined)
      const resolvedChoices = result instanceof Promise ? await result : result
      setChoices(resolvedChoices)
    }

    loadChoices()
  }, [searchQuery, source])

  // Reset selected index when choices change
  useEffect(() => {
    setSelectedIndex(0)
  }, [choices.length])

  // Calculate visible window based on selected index
  const {visibleItems: visibleChoices, windowStart} = useVisibleWindow(choices, selectedIndex, maxVisibleItems)

  // Handle keyboard input
  useInput((_input, key) => {
    if (key.upArrow) {
      setSelectedIndex((prev) => Math.max(0, prev - 1))
    } else if (key.downArrow) {
      setSelectedIndex((prev) => Math.min(choices.length - 1, prev + 1))
    } else if (key.return && choices[selectedIndex]) {
      onSelect(choices[selectedIndex].value)
    }
  })

  return (
    <Box flexDirection="column">
      <Text bold color={colors.text}>
        <Text color={colors.secondary}>? </Text>
        {message} <TextInput onChange={setSearchQuery} value={searchQuery} />
      </Text>
      <Box flexDirection="column">
        {visibleChoices.map((choice, index) => {
          const actualIndex = windowStart + index
          return (
            <Text color={actualIndex === selectedIndex ? colors.primary : colors.text} key={choice.name}>
              {actualIndex === selectedIndex ? '❯ ' : '  '}
              {choice.name}
            </Text>
          )
        })}
        {choices.length === 0 && <Text color={colors.errorText}>{'> '}No results found</Text>}
      </Box>
    </Box>
  )
}
