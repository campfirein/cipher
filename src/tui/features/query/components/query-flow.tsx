/**
 * QueryFlow Component
 *
 * Creates a query task via transport. Output is rendered
 * by useActivityLogs via the task event pipeline, not by this component.
 */

import {Text} from 'ink'
import Spinner from 'ink-spinner'
import React, {useEffect, useState} from 'react'

import type {CustomDialogCallbacks} from '../../../types/commands.js'

import {createQueryTask} from '../api/create-query-task.js'

interface QueryFlowProps extends CustomDialogCallbacks {
  flags?: {apiKey?: string; model?: string; verbose?: boolean}
  query: string
}

export function QueryFlow({onComplete, query}: QueryFlowProps): React.ReactNode {
  const [running, setRunning] = useState(true)
  const [error, setError] = useState<string>()

  useEffect(() => {
    createQueryTask({query})
      .then(() => {
        setRunning(false)
        // Task is queued - completion will come via task:completed event
        onComplete('')
      })
      .catch((error_: unknown) => {
        const message = error_ instanceof Error ? error_.message : String(error_)
        setRunning(false)
        setError(message)
        onComplete(`Query failed: ${message}`)
      })
  }, [])

  if (error) {
    return <Text color="red">Error: {error}</Text>
  }

  if (running) {
    return (
      <Text>
        <Spinner type="dots" /> Querying...
      </Text>
    )
  }

  return null
}
