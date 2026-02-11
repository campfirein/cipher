/**
 * CommandView - Helper component for simple commands.
 *
 * Handles the common "loading -> output -> done" lifecycle so simple commands
 * don't need boilerplate React state management.
 */

import {Text} from 'ink'
import Spinner from 'ink-spinner'
import React, {useEffect, useState} from 'react'

interface CommandViewProps {
  /** Called when the view is cancelled */
  onCancel: () => void
  /** Called when the view is done with the result message */
  onComplete: (message: string) => void
  /** Async function that produces the output text */
  run: () => Promise<string>
}

type ViewState = {error: string; type: 'error'} | {type: 'loading'}

export function CommandView({onComplete, run}: CommandViewProps): React.ReactNode {
  const [state, setState] = useState<ViewState>({type: 'loading'})

  useEffect(() => {
    let cancelled = false

    run()
      .then((result) => {
        if (!cancelled) onComplete(result)
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : String(error)
          setState({error: message, type: 'error'})
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  if (state.type === 'error') {
    return <Text color="red">Error: {state.error}</Text>
  }

  return (
    <Text>
      <Spinner type="dots" /> Loading...
    </Text>
  )
}
