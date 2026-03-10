import {Text, useInput} from 'ink'
import Spinner from 'ink-spinner'
import React, {useEffect} from 'react'

import type {CustomDialogCallbacks} from '../../../../types/commands.js'

import {useExecuteVcAdd} from '../api/execute-vc-add.js'

type VcAddFlowProps = CustomDialogCallbacks & {
  filePaths: string[]
}

export function VcAddFlow({filePaths, onCancel, onComplete}: VcAddFlowProps): React.ReactNode {
  const addMutation = useExecuteVcAdd()

  useInput((_, key) => {
    if (key.escape && !addMutation.isPending) {
      onCancel()
    }
  })

  useEffect(() => {
    addMutation.mutate(
      {filePaths},
      {
        onError(error) {
          onComplete(`Failed to stage: ${error.message}`)
        },
        onSuccess(result) {
          if (result.count === 0) {
            onComplete('Nothing to stage.')
          } else {
            onComplete(`Staged ${result.count} file(s).`)
          }
        },
      },
    )
  }, [])

  const label = filePaths.length === 1 && filePaths[0] === '.' ? '.' : filePaths.join(' ')

  return (
    <Text>
      <Spinner type="dots" /> Staging {label}...
    </Text>
  )
}
