/**
 * Enter Prompt Component
 *
 * Displays "Press Enter to {action}" prompt
 */

import {Text, useInput} from 'ink'
import React from 'react'

import {useTheme} from '../hooks/index.js'

interface EnterPromptProps {
  action: string
  active?: boolean
  onEnter?: () => void
}

export const EnterPrompt: React.FC<EnterPromptProps> = ({action, active = true, onEnter}) => {
  const {theme: {colors}} = useTheme()

  useInput(
    (_input, key) => {
      if (key.return && active) {
        onEnter?.()
      }
    },
    {isActive: active},
  )

  return (
    <Text color={colors.dimText}>
      Press{' '}
      <Text backgroundColor={colors.primary} color={colors.text}>
        {' Enter '}
      </Text>{' '}
      to {action}
    </Text>
  )
}
