/**
 * Logs View
 *
 * Activity log display using ScrollableList with dynamic height calculation
 */

import {Box, Spacer, Text} from 'ink'
import Spinner from 'ink-spinner'
import {join} from 'node:path'
import React, {useCallback, useMemo} from 'react'

import {BRV_DIR, CONTEXT_TREE_DIR} from '../../constants.js'
import {ToolCall} from '../../core/domain/cipher/queue/types.js'
import {ScrollableList} from '../components/index.js'
import {useConsumer} from '../contexts/index.js'
import {useMode, useTheme} from '../hooks/index.js'
import {ActivityLog} from '../types.js'

const MAX_PROGRESS_ITEMS = 3

function safeJsonParse<T = unknown>(jsonString: string, fallback: null | T = null): null | T {
  try {
    return JSON.parse(jsonString) as T
  } catch {
    return fallback
  }
}

function composeChangesFromToolCalls(toolCalls: ToolCall[]): {created: string[]; updated: string[]} {
  const changes: {created: string[]; updated: string[]} = {created: [], updated: []}
  const contextTreeDir = join(BRV_DIR, CONTEXT_TREE_DIR)

  for (const tc of toolCalls) {
    if (tc.status === 'completed' && tc.name === 'create_knowledge_topic' && tc.result) {
      try {
        const parsed = JSON.parse(tc.result)
        const result = parsed.result || {}

        // Process created topics
        for (const item of result.created || []) {
          if (item.subtopics && item.subtopics.length > 0) {
            for (const subtopic of item.subtopics) {
              changes.created.push(join(contextTreeDir, item.domain, item.topic, subtopic, 'context.md'))
            }
          } else {
            changes.created.push(join(contextTreeDir, item.domain, item.topic, 'context.md'))
          }
        }

        // Process updated topics
        for (const item of result.updated || []) {
          if (item.subtopics && item.subtopics.length > 0) {
            for (const subtopic of item.subtopics) {
              changes.created.push(join(contextTreeDir, item.domain, item.topic, subtopic, 'context.md'))
            }
          } else {
            changes.created.push(join(contextTreeDir, item.domain, item.topic, 'context.md'))
          }
        }
      } catch {
        // Ignore parse errors
      }
    }
  }

  return changes
}

/**
 * Estimate the line height of a log item
 */
function estimateLogHeight(log: ActivityLog): number {
  let lines = 0

  // Header line: [type] @source [timestamp]
  lines += 1

  // Input box with border (top border + content + bottom border)
  lines += 3

  // Progress items (max MAX_PROGRESS_ITEMS shown + optional "more" line)
  const progressCount = Math.min(log.progress?.length ?? 0, MAX_PROGRESS_ITEMS)
  lines += progressCount
  if ((log.progress?.length ?? 0) > MAX_PROGRESS_ITEMS) {
    lines += 1 // "... and X more" line
  }

  // Processing spinner (if running)
  if (log.status === 'running') {
    lines += 1
  }

  // Content box (if completed or failed)
  if (log.status === 'completed' || log.status === 'failed') {
    // Estimate content lines (at least 3 for border + 1 line content)
    const contentLines = Math.ceil((log.content?.length ?? 0) / 80) || 1
    lines += 2 + contentLines // borders + content
  }

  // Changes sections
  if (log.status === 'completed') {
    if (log.changes.created.length > 0) {
      lines += 1 + log.changes.created.length
    }

    if (log.changes.updated.length > 0) {
      lines += 1 + log.changes.updated.length
    }
  }

  // Bottom margin
  lines += 1

  return lines
}

interface LogsViewProps {
  availableHeight: number
}

export const LogsView: React.FC<LogsViewProps> = ({availableHeight}) => {
  const {
    theme: {colors},
  } = useTheme()
  const {mode} = useMode()
  const {sessionExecutions} = useConsumer()

  const logs = useMemo(
    () =>
      sessionExecutions.map(({execution, toolCalls}) => {
        const progress = toolCalls.map((tc) => ({
          id: tc.id,
          status: tc.status,
          toolCallName: tc.name,
        }))

        const changes = composeChangesFromToolCalls(toolCalls)

        const activityLog: ActivityLog = {
          changes,
          content: execution.status === 'failed' ? execution.error ?? '' : execution.result ?? '',
          id: execution.id,
          input: safeJsonParse<{content: string}>(execution.input, {content: execution.input})?.content ?? '',
          progress,
          source: 'agent',
          status: execution.status,
          timestamp: new Date(execution.updatedAt),
          type: execution.type,
        }

        return activityLog
      }),
    [sessionExecutions],
  )

  const renderLogItem = useCallback(
    (log: ActivityLog) => (
      <Box flexDirection="column" marginBottom={1} width="100%">
        <Box>
          <Text color={log.type === 'curate' ? colors.curateCommand : colors.queryCommand}>[{log.type}] </Text>
          <Text color={colors.dimText}>@{log.source ?? 'system'}</Text>
          <Spacer />
          <Text color={colors.dimText}>[{log.timestamp.toISOString().slice(11, 19)}]</Text>
        </Box>
        <Box borderColor={colors.border} borderStyle="single">
          <Text>
            {'> '}
            {log.input}
          </Text>
        </Box>
        <Box flexDirection="column">
          {log.progress && log.progress.length > MAX_PROGRESS_ITEMS && (
            <Box rowGap={1}>
              <Text color={colors.dimText}>... and {log.progress.length - MAX_PROGRESS_ITEMS} more</Text>
            </Box>
          )}
          {log.progress &&
            log.progress
              .slice(-MAX_PROGRESS_ITEMS)
              .reverse()
              .map((progress) => (
                <Box key={progress.id}>
                  {progress.status === 'completed' && <Text color={colors.primary}>✓ </Text>}
                  {progress.status === 'running' && (
                    <Text color={colors.dimText}>
                      <Spinner type="dots" />{' '}
                    </Text>
                  )}
                  {progress.status === 'failed' && <Text color={colors.errorText}>✗ </Text>}
                </Box>
              ))}
          {log.status === 'running' && (
            <Text color={colors.dimText}>
              <Spinner type="line" /> Processing...
            </Text>
          )}
        </Box>
        {(log.status === 'failed' || log.status === 'completed') && (
          <Box borderColor={colors.border} borderStyle="single">
            <Text color={log.status === 'failed' ? colors.errorText : colors.text}>{log.content}</Text>
          </Box>
        )}
        {log.status === 'completed' && log.changes.created.length > 0 && (
          <Box columnGap={1}>
            <Text color={colors.secondary}>created at:</Text>
            <Box flexDirection="column">
              {log.changes.created.map((memoryPath) => (
                <Text key={memoryPath}>{memoryPath}</Text>
              ))}
            </Box>
          </Box>
        )}
        {log.status === 'completed' && log.changes.updated.length > 0 && (
          <Box columnGap={1}>
            <Text color={colors.secondary}>updated at:</Text>
            <Box flexDirection="column">
              {log.changes.updated.map((memoryPath) => (
                <Text key={memoryPath}>{memoryPath}</Text>
              ))}
            </Box>
          </Box>
        )}
      </Box>
    ),
    [colors],
  )

  const keyExtractor = useCallback((log: ActivityLog) => log.id, [])

  // Account for the bottom border (1 line)
  const scrollableHeight = Math.max(1, availableHeight - 1)

  return (
    <Box
      borderColor={colors.border}
      borderLeft={false}
      borderRight={false}
      borderStyle="single"
      borderTop={false}
      flexDirection="column"
      height="100%"
      width="100%"
    >
      {logs.length > 0 ? (
        <Box flexDirection="column" height="100%" paddingX={2}>
          <ScrollableList
            autoScrollToBottom
            availableHeight={scrollableHeight}
            estimateItemHeight={estimateLogHeight}
            isActive={mode === 'activity'}
            items={logs}
            keyExtractor={keyExtractor}
            renderItem={renderLogItem}
          />
        </Box>
      ) : (
        <>
          <Text color="gray">Activity logs will appear here...</Text>
          <Spacer />
        </>
      )}
    </Box>
  )
}
