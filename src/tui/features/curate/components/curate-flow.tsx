/**
 * CurateFlow Component
 *
 * Creates a curate task via transport. Output is rendered
 * by useActivityLogs via the task event pipeline, not by this component.
 */

import {Text} from 'ink'
import Spinner from 'ink-spinner'
import React, {useEffect, useState} from 'react'

import type {CustomDialogCallbacks} from '../../../types/commands.js'

import {createCurateTask} from '../api/create-curate-task.js'

interface CurateFlowProps extends CustomDialogCallbacks {
  context?: string
  files?: string[]
  flags?: {apiKey?: string; model?: string; verbose?: boolean}
}

export function CurateFlow({context, files, onComplete}: CurateFlowProps): React.ReactNode {
  const [running, setRunning] = useState(true)
  const [error, setError] = useState<string>()

  useEffect(() => {
    createCurateTask({
      content: context,
      files: files && files.length > 0 ? files : undefined,
    })
      .then(() => {
        setRunning(false)
        // Task is queued - completion will come via task:completed event
        onComplete('')
      })
      .catch((error_: unknown) => {
        const message = error_ instanceof Error ? error_.message : String(error_)
        setRunning(false)
        setError(message)
        onComplete(`Curate failed: ${message}`)
      })
  }, [])

  if (error) {
    return <Text color="red">Error: {error}</Text>
  }

  if (running) {
    return (
      <Text>
        <Spinner type="dots" /> Curating...
      </Text>
    )
  }

  return null
}
