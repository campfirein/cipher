/**
 * Execution Progress Component
 *
 * Displays tool calls and reasoning content sorted by timestamp.
 * Renders ExecutionTool for tool calls and ExecutionReasoning for reasoning items.
 */

import {Box} from 'ink'
import React, {useMemo} from 'react'

import type {ReasoningContentItem, ToolProgressItem} from '../../types/messages.js'

import {useTheme} from '../../hooks/index.js'
import {ExecutionReasoning} from './execution-reasoning.js'
import {ExecutionTool} from './execution-tool.js'

/** Default maximum number of items to display */
const DEFAULT_MAX_ITEMS = 3

/**
 * Union type for sorted items
 */
type ProgressItem =
  | {data: ReasoningContentItem; timestamp: number; type: 'reasoning'}
  | {data: ToolProgressItem; timestamp: number; type: 'tool'}

interface ExecutionProgressProps {
  /** Whether content should be fully expanded (no truncation) */
  isExpanded?: boolean
  /** Maximum number of items to display (default: 5) */
  maxItems?: number
  /** Array of reasoning content items */
  reasoningContents?: ReasoningContentItem[]
  /** Array of tool call items */
  toolCalls?: ToolProgressItem[]
}

export const ExecutionProgress: React.FC<ExecutionProgressProps> = ({
  isExpanded = false,
  maxItems = DEFAULT_MAX_ITEMS,
  reasoningContents,
  toolCalls,
}) => {
  const {
    theme: {colors},
  } = useTheme()

  const sortedItems = useMemo(() => {
    const items: ProgressItem[] = []

    if (toolCalls) {
      for (const tc of toolCalls) {
        items.push({
          data: tc,
          timestamp: tc.timestamp,
          type: 'tool',
        })
      }
    }

    if (reasoningContents) {
      for (const rc of reasoningContents) {
        items.push({
          data: rc,
          timestamp: rc.timestamp,
          type: 'reasoning',
        })
      }
    }

    // Sort by: 1) timestamp ascending, 2) running status last
    // Running items at the end so they appear when slicing last N items
    return items.sort((a, b) => {
      // Check if item is running (tool with status 'running' or reasoning with isThinking)
      const aIsRunning = a.type === 'tool' ? a.data.status === 'running' : a.data.isThinking
      const bIsRunning = b.type === 'tool' ? b.data.status === 'running' : b.data.isThinking

      // Running items come last (to appear in slice(-maxItems))
      if (aIsRunning && !bIsRunning) return 1
      if (!aIsRunning && bIsRunning) return -1

      // Within same status, sort by timestamp ascending
      return a.timestamp - b.timestamp
    })
  }, [toolCalls, reasoningContents])

  if (sortedItems.length === 0) {
    return null
  }

  if (isExpanded) {
    return (
      <Box backgroundColor={colors.bg2} flexDirection="column" marginBottom={1} padding={1} width="100%">
        {sortedItems.map((item, index) => {
          const key = item.type === 'tool'
            ? `tool-${item.data.id}-${index}`
            : `reasoning-${item.timestamp}-${index}`

          // Add space when type changes from previous item
          const prevItem = index > 0 ? sortedItems[index - 1] : null
          const hasTypeChange = prevItem && prevItem.type !== item.type

          if (item.type === 'tool') {
            return (
              <Box key={key} marginTop={hasTypeChange ? 1 : 0}>
                <ExecutionTool isExpanded toolCall={item.data} />
              </Box>
            )
          }

          return (
            <Box key={key} marginTop={hasTypeChange ? 1 : 0}>
              <ExecutionReasoning isExpanded reasoningContent={item.data} />
            </Box>
          )
        })}
      </Box>
    )
  }

  // Show limited items from the end (most recent)
  const visibleItems = sortedItems.slice(-maxItems)

  return (
    <Box flexDirection="column">
      {visibleItems.map((item, index) => {
        const key = item.type === 'tool'
          ? `tool-${item.data.id}-${index}`
          : `reasoning-${item.timestamp}-${index}`

        if (item.type === 'tool') {
          return <ExecutionTool key={key} toolCall={item.data} />
        }

        return <ExecutionReasoning key={key} reasoningContent={item.data} />
      })}
    </Box>
  )
}
