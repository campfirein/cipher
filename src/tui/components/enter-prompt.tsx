/**
 * Enter Prompt Component
 *
 * Displays "Press Enter to {action}" prompt
 */

import {Text, useInput} from 'ink'
import React from 'react'

interface EnterPromptProps {
  action: string
  active?: boolean
  onEnter?: () => void
}

export const EnterPrompt: React.FC<EnterPromptProps> = ({action, active = true, onEnter}) => {
  useInput(
    (_input, key) => {
      if (key.return && active) {
        onEnter?.()
      }
    },
    {isActive: active},
  )

  return (
    <Text color="gray">
      Press{' '}
      <Text backgroundColor="cyan" color="black">
        {' Enter '}
      </Text>{' '}
      to {action}
    </Text>
  )
}
