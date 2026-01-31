/**
 * Main View
 *
 * Main view with list display and command input.
 */

import {Box} from 'ink'
import React, {useState} from 'react'

import {CommandInput, MessageList} from '../components/index.js'
import {useOnboarding} from '../contexts/index.js'

interface MainViewProps {
  /** Available height for the view (in terminal rows) */
  availableHeight: number
}

export const MainView: React.FC<MainViewProps> = ({availableHeight}) => {
  const [expandedIndex, setExpandedIndex] = useState<null | number>(null)
  const isExpanded = expandedIndex !== null
  const {initFlowCompleted, isLoadingOnboardingCheck, shouldShowOnboarding} = useOnboarding()

  // Height for input area (border + text input)
  const inputHeight = isExpanded || !initFlowCompleted ? 0 : 3
  const listHeight = Math.max(1, availableHeight - inputHeight)
  const shouldShowInput = !isExpanded && (shouldShowOnboarding || initFlowCompleted) && !isLoadingOnboardingCheck

  return (
    <Box flexDirection="column" height="100%" paddingX={1} width="100%">
      <MessageList
        expandedIndex={expandedIndex}
        height={listHeight}
        onExpandedIndexChange={setExpandedIndex}
      />
      {shouldShowInput && <CommandInput />}
    </Box>
  )
}
