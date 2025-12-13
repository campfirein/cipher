/**
 * Logs View
 *
 * Activity log display
 */

import type {ScrollViewRef} from 'ink-scroll-view'

import {Box, Spacer, Text, useInput, useStdout} from 'ink'
import {ScrollView} from 'ink-scroll-view'
import Spinner from 'ink-spinner'
import {join} from 'node:path'
import React, {useEffect, useMemo, useRef} from 'react'

import {BRV_DIR, CONTEXT_TREE_DIR} from '../../constants.js'
import {ToolCall} from '../../core/domain/cipher/queue/types.js'
import {useConsumer} from '../contexts/index.js'
import {useMode, useTheme} from '../hooks/index.js'
import {ActivityLog} from '../types.js'

/**
 * Compose changes from completed create_knowledge_topic toolCalls
 */
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

export const LogsView: React.FC = () => {
  const {
    theme: {colors},
  } = useTheme()
  const {mode} = useMode()
  const scrollRef = useRef<ScrollViewRef>(null)
  const {stdout} = useStdout()
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
          input: JSON.parse(execution.input).content,
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

  useEffect(() => {
    const handleResize = () => scrollRef.current?.remeasure()
    stdout?.on('resize', handleResize)
    return () => {
      stdout?.off('resize', handleResize)
    }
  }, [stdout])

  useInput(
    (input, key) => {
      // Copy latest log with Ctrl+Y
      if (key.ctrl && input === 'y') {
        // Implement copy command here
        return
      }

      const scroll = scrollRef.current
      if (!scroll) return

      const currentOffset = scroll.getScrollOffset()
      const contentHeight = scroll.getContentHeight()
      const viewportHeight = scroll.getViewportHeight()

      // Only scroll up if not at the top
      if (key.upArrow && currentOffset > 0) {
        scroll.scrollBy(-2)
      }

      // Only scroll down if not at the bottom
      if (key.downArrow && currentOffset + viewportHeight < contentHeight) {
        scroll.scrollBy(2)
      }
    },
    {isActive: mode === 'activity'},
  )

  useEffect(() => {
    if (logs.length > 0) {
      scrollRef.current?.scrollToBottom()
    }
  }, [logs.length])

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
        <Box flexDirection="column" flexGrow={1} paddingX={2}>
          <ScrollView ref={scrollRef}>
            {logs.map((log) => (
              <Box flexDirection="column" key={log.id} marginBottom={1} width="100%">
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
                  {log.progress && log.progress.length > 3 && (
                    <Box rowGap={1}>
                      <Text color={colors.dimText}>... and {log.progress.length - 3} more</Text>
                    </Box>
                  )}
                  {log.progress &&
                    log.progress.slice(0, 3).map((progress) => (
                      <Box key={progress.id}>
                        {progress.status === 'completed' && <Text color={colors.primary}>✓ </Text>}
                        {progress.status === 'running' && (
                          <Text color={colors.dimText}>
                            <Spinner type="dots" />{' '}
                          </Text>
                        )}
                        {progress.status === 'failed' && <Text color={colors.errorText}>✗ </Text>}
                        <Text color={colors.dimText}>{progress.toolCallName}</Text>
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
            ))}
          </ScrollView>
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
