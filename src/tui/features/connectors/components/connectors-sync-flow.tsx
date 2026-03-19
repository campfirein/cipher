import {Text, useInput} from 'ink'
import Spinner from 'ink-spinner'
import React, {useEffect, useRef} from 'react'

import type {CustomDialogCallbacks} from '../../../types/commands.js'

import {useExecuteSyncSkill} from '../api/execute-sync-skill.js'

export function ConnectorsSyncFlow({onCancel, onComplete}: CustomDialogCallbacks): React.ReactNode {
  const syncMutation = useExecuteSyncSkill()
  const dismissedRef = useRef(false)

  useInput((_input, key) => {
    if (key.escape) {
      dismissedRef.current = true
      onCancel()
    }
  })

  useEffect(() => () => {
    dismissedRef.current = true
  }, [])

  useEffect(() => {
    syncMutation.mutate(undefined, {
      onError(error) {
        if (dismissedRef.current) return
        onComplete(`Failed to sync skill knowledge: ${error.message}`)
      },
      onSuccess(result) {
        if (dismissedRef.current) return
        const lines: string[] = []

        if (result.block.length === 0) {
          lines.push('No project knowledge accumulated yet. Run `brv curate` to start.')
        }

        const totalTargets = result.updated.length + result.failed.length

        if (totalTargets === 0) {
          lines.push('No skill connectors installed. Use `/connectors` to set up.')
        } else {
          if (result.updated.length > 0) {
            const targets = result.updated.map((t) => `${t.agent} (${t.scope})`).join(', ')
            lines.push(`Synced to ${result.updated.length} target(s): ${targets}`)
          }

          if (result.failed.length > 0) {
            const failures = result.failed.map((f) => `${f.agent} (${f.scope}): ${f.error}`).join(', ')
            lines.push(`Failed ${result.failed.length} target(s): ${failures}`)
          }
        }

        onComplete(lines.join('\n'))
      },
    })
  }, [])

  return (
    <Text>
      <Spinner type="dots" /> Syncing project knowledge into SKILL.md files...
    </Text>
  )
}
