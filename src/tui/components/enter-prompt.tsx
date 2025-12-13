/**
 * Enter Prompt Component
 *
 * Displays "Press Enter to {action}" prompt
 */

import {Text} from 'ink'
import React from 'react'

interface EnterPromptProps {
  action: string
}

export const EnterPrompt: React.FC<EnterPromptProps> = ({action}) => (
  <Text color="gray">
    Press{' '}
    <Text backgroundColor="cyan" color="black">
      {' Enter '}
    </Text>{' '}
    to {action}
  </Text>
)
