import {Box, Text, useApp, useInput} from 'ink'
import Spinner from 'ink-spinner'
import React, {useEffect, useState} from 'react'

import type {QueueStats} from '../consumer/queue-polling-service.js'
import type {Execution, ToolCall} from '../storage/agent-storage.js'

import {ConsumerService} from '../consumer/consumer-service.js'
import {stopQueuePollingService} from '../consumer/queue-polling-service.js'
import {useQueuePolling} from './use-queue-polling.js'

// ==================== HELPER FUNCTIONS ====================

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleTimeString()
}

function formatDuration(startMs: number, endMs?: number): string {
  const duration = (endMs ?? Date.now()) - startMs
  if (duration < 1000) return `${duration}ms`
  if (duration < 60_000) return `${(duration / 1000).toFixed(1)}s`
  return `${(duration / 60_000).toFixed(1)}m`
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen - 3) + '...'
}

// ==================== COMPONENTS ====================

/**
 * Header component
 */
function Header({consumerStatus}: {consumerStatus: 'error' | 'running' | 'starting' | 'stopped'}): React.ReactElement {
  const statusColor = consumerStatus === 'running' ? 'green' : consumerStatus === 'error' ? 'red' : 'yellow'
  const statusText = consumerStatus === 'running' ? '● Consumer Running'
    : consumerStatus === 'starting' ? '○ Starting...'
    : consumerStatus === 'error' ? '✗ Consumer Error'
    : '○ Consumer Stopped'

  return (
    <Box borderStyle="single" paddingX={1}>
      <Text bold color="cyan">
        ByteRover Queue Dashboard
      </Text>
      <Text color="gray"> | </Text>
      <Text color={statusColor}>{statusText}</Text>
      <Text color="gray"> | Press 'q' to quit</Text>
    </Box>
  )
}

/**
 * Stats panel showing queue statistics
 */
function StatsPanel({stats}: {stats: null | QueueStats}): React.ReactElement {
  if (!stats) {
    return (
      <Box borderStyle="single" paddingX={1}>
        <Text color="gray">Loading stats...</Text>
      </Box>
    )
  }

  return (
    <Box borderStyle="single" flexDirection="row" gap={2} paddingX={1}>
      <Box flexDirection="column">
        <Text bold>Queue Status</Text>
        <Box gap={4} marginTop={1}>
          <Box flexDirection="column">
            <Text color="yellow">{stats.queued}</Text>
            <Text color="gray">Queued</Text>
          </Box>
          <Box flexDirection="column">
            <Text color="blue">{stats.running}</Text>
            <Text color="gray">Running</Text>
          </Box>
          <Box flexDirection="column">
            <Text color="green">{stats.completed}</Text>
            <Text color="gray">Completed</Text>
          </Box>
          <Box flexDirection="column">
            <Text color="red">{stats.failed}</Text>
            <Text color="gray">Failed</Text>
          </Box>
          <Box flexDirection="column">
            <Text>{stats.total}</Text>
            <Text color="gray">Total</Text>
          </Box>
        </Box>
      </Box>
    </Box>
  )
}

/**
 * Single running execution item
 */
function RunningExecutionItem({
  execution,
  index,
  toolCalls,
}: {
  execution: Execution
  index: number
  toolCalls: ToolCall[]
}): React.ReactElement {
  // Parse input to get content preview
  let contentPreview = ''
  try {
    const input = JSON.parse(execution.input) as {content?: string}
    contentPreview = truncate((input.content ?? '').replaceAll('\n', ' '), 50)
  } catch {
    contentPreview = truncate(execution.input, 50)
  }

  return (
    <Box borderColor="blue" borderStyle="single" flexDirection="column" marginBottom={1} paddingX={1}>
      <Box gap={2}>
        <Text color="blue">
          <Spinner type="dots" />
        </Text>
        <Text bold color="blue">#{index + 1}</Text>
        <Text bold color={execution.type === 'query' ? 'cyan' : 'yellow'}>[{execution.type.toUpperCase()}]</Text>
        <Text color="gray">{execution.id.slice(0, 8)}</Text>
        <Text color="magenta">{execution.startedAt ? formatDuration(execution.startedAt) : ''}</Text>
      </Box>
      <Text>"{contentPreview}"</Text>
      {toolCalls.length > 0 && (
        <Box gap={1} marginTop={0}>
          <Text color="gray">Tools:</Text>
          {toolCalls.slice(-3).map((tc) => (
            <Text color={tc.status === 'completed' ? 'green' : tc.status === 'failed' ? 'red' : 'yellow'} key={tc.id}>
              {tc.status === 'completed' ? '✓' : tc.status === 'failed' ? '✗' : '●'}{tc.name}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  )
}

/**
 * Running executions panel - shows ALL running executions
 */
function RunningExecutionsPanel({
  runningExecutions,
}: {
  runningExecutions: Array<{execution: Execution; toolCalls: ToolCall[]}>
}): React.ReactElement {
  return (
    <Box borderStyle="single" flexDirection="column" paddingX={1}>
      <Box gap={2}>
        <Text bold>Running ({runningExecutions.length})</Text>
        {runningExecutions.length > 0 && (
          <Text color="blue">
            <Spinner type="dots" />
          </Text>
        )}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {runningExecutions.length === 0 ? (
          <Text color="gray">No executions running</Text>
        ) : (
          runningExecutions.map((item, index) => (
            <RunningExecutionItem
              execution={item.execution}
              index={index}
              key={item.execution.id}
              toolCalls={item.toolCalls}
            />
          ))
        )}
      </Box>
    </Box>
  )
}

/**
 * Single execution item with full details
 */
function ExecutionItem({exec}: {exec: Execution}): React.ReactElement {
  // Parse input to get content
  let contentPreview = ''
  try {
    const input = JSON.parse(exec.input) as {content?: string}
    contentPreview = truncate((input.content ?? '').replaceAll('\n', ' '), 70)
  } catch {
    contentPreview = truncate(exec.input, 70)
  }

  const statusIcon =
    exec.status === 'completed'
      ? '✓'
      : exec.status === 'failed'
        ? '✗'
        : exec.status === 'running'
          ? '●'
          : '○'

  const statusColor =
    exec.status === 'completed'
      ? 'green'
      : exec.status === 'failed'
        ? 'red'
        : exec.status === 'running'
          ? 'blue'
          : 'yellow'

  // Calculate duration
  const duration = exec.startedAt
    ? formatDuration(exec.startedAt, exec.completedAt ?? (exec.status === 'running' ? undefined : exec.updatedAt))
    : '-'

  return (
    <Box borderColor="gray" borderStyle="single" flexDirection="column" marginBottom={1} paddingX={1}>
      {/* Header row: status, type, time, duration, id */}
      <Box gap={2}>
        <Text color={statusColor}>{statusIcon} {exec.status.toUpperCase()}</Text>
        <Text bold color={exec.type === 'query' ? 'cyan' : 'yellow'}>[{exec.type.toUpperCase()}]</Text>
        <Text color="gray">{formatTime(exec.createdAt)}</Text>
        <Text color="magenta">{duration}</Text>
        <Text color="gray">#{exec.id.slice(0, 8)}</Text>
      </Box>

      {/* Content */}
      <Box marginTop={0}>
        <Text color="gray">Input: </Text>
        <Text>"{contentPreview}"</Text>
      </Box>

      {/* Result or Error */}
      {exec.status === 'completed' && exec.result && (
        <Box>
          <Text color="green">Result: </Text>
          <Text>{truncate(exec.result.replaceAll('\n', ' '), 60)}</Text>
        </Box>
      )}
      {exec.status === 'failed' && exec.error && (
        <Box>
          <Text color="red">Error: </Text>
          <Text color="red">{truncate(exec.error, 60)}</Text>
        </Box>
      )}
    </Box>
  )
}

/**
 * Recent executions list with full details
 */
function RecentExecutionsPanel({executions}: {executions: Execution[]}): React.ReactElement {
  // Filter out running executions (shown in CurrentExecutionPanel)
  const recentCompleted = executions.filter((e) => e.status !== 'running')

  return (
    <Box borderStyle="single" flexDirection="column" paddingX={1}>
      <Text bold>Execution History ({recentCompleted.length})</Text>
      <Box flexDirection="column" marginTop={1}>
        {recentCompleted.length === 0 ? (
          <Text color="gray">No completed executions yet</Text>
        ) : (
          recentCompleted.slice(0, 5).map((exec) => (
            <ExecutionItem exec={exec} key={exec.id} />
          ))
        )}
      </Box>
    </Box>
  )
}

/**
 * Error display
 */
function ErrorPanel({error}: {error: Error}): React.ReactElement {
  return (
    <Box borderColor="red" borderStyle="single" paddingX={1}>
      <Text color="red">Error: {error.message}</Text>
    </Box>
  )
}

/**
 * Loading state
 */
function LoadingPanel(): React.ReactElement {
  return (
    <Box paddingX={1}>
      <Text color="gray">
        <Spinner type="dots" /> Connecting to queue...
      </Text>
    </Box>
  )
}

// ==================== MAIN DASHBOARD ====================

interface QueueDashboardProps {
  pollInterval?: number
}

type ConsumerStatus = 'error' | 'running' | 'starting' | 'stopped'

/**
 * Hook to manage consumer lifecycle
 */
function useConsumer(): {consumerError: Error | null; consumerStatus: ConsumerStatus} {
  const [status, setStatus] = useState<ConsumerStatus>('starting')
  const [consumerError, setConsumerError] = useState<Error | null>(null)
  const [consumer] = useState(() => new ConsumerService())

  useEffect(() => {
    let mounted = true

    const startConsumer = async (): Promise<void> => {
      try {
        await consumer.start()
        if (mounted) {
          setStatus('running')
        }
      } catch (error) {
        if (mounted) {
          setStatus('error')
          setConsumerError(error instanceof Error ? error : new Error(String(error)))
        }
      }
    }

    startConsumer()

    return () => {
      mounted = false
      consumer.dispose()
      setStatus('stopped')
    }
  }, [consumer])

  return {consumerError, consumerStatus: status}
}

/**
 * Main Queue Dashboard component
 *
 * Architecture:
 * - Starts ConsumerService on mount, stops on unmount
 * - Uses useQueuePolling hook to subscribe to polling service
 * - Renders panels for stats, running executions, recent executions
 * - Handles keyboard input for quit
 */
export function QueueDashboard({pollInterval = 500}: QueueDashboardProps): React.ReactElement {
  const {exit} = useApp()
  const {consumerError, consumerStatus} = useConsumer()
  const {error, isConnected, recentExecutions, runningExecutions, stats} = useQueuePolling({
    pollInterval,
  })

  // Handle keyboard input
  useInput((input) => {
    if (input === 'q') {
      stopQueuePollingService()
      exit()
    }
  })

  // Cleanup polling on unmount
  useEffect(() => () => {
      stopQueuePollingService()
    }, [])

  const displayError = error ?? consumerError

  return (
    <Box flexDirection="column" padding={1}>
      <Header consumerStatus={consumerStatus} />

      {displayError && <ErrorPanel error={displayError} />}

      {isConnected ? (
        <>
          <StatsPanel stats={stats} />

          <Box gap={1} marginTop={1}>
            <Box flexBasis="50%">
              <RunningExecutionsPanel runningExecutions={runningExecutions} />
            </Box>
            <Box flexBasis="50%">
              <RecentExecutionsPanel executions={recentExecutions} />
            </Box>
          </Box>
        </>
      ) : (
        <LoadingPanel />
      )}
    </Box>
  )
}
