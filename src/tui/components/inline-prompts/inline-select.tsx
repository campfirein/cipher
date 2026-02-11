/**
 * InlineSelect Component
 *
 * Generic inline selection prompt with multiple choices.
 * Shows description of selected item below the list.
 * Shows max items with a sliding window that follows selection.
 */

import {Box, Text, useInput} from 'ink'
import React, {useState} from 'react'

import type {PromptChoice} from '../../types/index.js'

import {useTheme, useVisibleWindow} from '../../hooks/index.js'

export interface InlineSelectProps<T = unknown> {
  /** Available choices */
  choices: Array<PromptChoice<T>>
  /** Maximum number of visible items in the list (default: 7) */
  maxVisibleItems?: number
  /** The prompt message */
  message: string
  /** Callback when user selects a value */
  onSelect: (value: T) => void
}

export function InlineSelect<T>({
  choices,
  maxVisibleItems = 7,
  message,
  onSelect,
}: InlineSelectProps<T>): React.ReactElement {
  const {
    theme: {colors},
  } = useTheme()
  const [selectedIndex, setSelectedIndex] = useState(0)

  const selectedChoice = choices[selectedIndex]

  // Calculate visible window based on selected index
  const {visibleItems: visibleChoices, windowStart} = useVisibleWindow(choices, selectedIndex, maxVisibleItems)

  // Handle keyboard input
  useInput((_input, key) => {
    if (key.upArrow) {
      setSelectedIndex((prev) => Math.max(0, prev - 1))
    } else if (key.downArrow) {
      setSelectedIndex((prev) => Math.min(choices.length - 1, prev + 1))
    } else if (key.return && selectedChoice) {
      onSelect(selectedChoice.value)
    }
  })

  return (
    <Box flexDirection="column">
      <Text bold color={colors.text}>
        <Text color={colors.secondary}>? </Text>
        {message}
      </Text>
      <Box flexDirection="column">
        {visibleChoices.map((choice, index) => {
          const actualIndex = windowStart + index
          const isSelected = actualIndex === selectedIndex
          return (
            <Box key={choice.name}>
              <Text color={isSelected ? colors.primary : colors.text}>
                {isSelected ? '❯ ' : '  '}
                {choice.name}
              </Text>
              {choice.description && <Text color={colors.dimText}> · {choice.description}</Text>}
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}
