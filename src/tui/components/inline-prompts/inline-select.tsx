/**
 * InlineSelect Component
 *
 * Generic inline selection prompt with multiple choices.
 * Shows description of selected item below the list.
 */

import {Box, Text, useInput} from 'ink'
import React, {useState} from 'react'

import type {PromptChoice} from '../../types.js'

import {useTheme} from '../../hooks/index.js'

export interface InlineSelectProps<T = unknown> {
  /** Available choices */
  choices: Array<PromptChoice<T>>
  /** The prompt message */
  message: string
  /** Callback when user selects a value */
  onSelect: (value: T) => void
}

export function InlineSelect<T>({choices, message, onSelect}: InlineSelectProps<T>): React.ReactElement {
  const {
    theme: {colors},
  } = useTheme()
  const [selectedIndex, setSelectedIndex] = useState(0)

  const selectedChoice = choices[selectedIndex]

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
        {choices.map((choice, index) => (
          <Text color={index === selectedIndex ? colors.primary : colors.text} key={choice.name}>
            {index === selectedIndex ? '❯ ' : '  '}
            {choice.name}
          </Text>
        ))}
      </Box>
      {selectedChoice?.description && (
        <Box marginTop={1}>
          <Text color={colors.secondary}>{selectedChoice.description}</Text>
        </Box>
      )}
    </Box>
  )
}
