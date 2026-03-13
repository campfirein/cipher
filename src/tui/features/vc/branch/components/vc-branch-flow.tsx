import {Text, useInput} from 'ink'
import Spinner from 'ink-spinner'
import React, {useEffect} from 'react'

import type {IVcBranchRequest, VcBranchAction} from '../../../../../shared/transport/events/vc-events.js'
import type {CustomDialogCallbacks} from '../../../../types/commands.js'

import {formatTransportError} from '../../../../utils/error-messages.js'
import {useExecuteVcBranch} from '../api/execute-vc-branch.js'
import {formatBranchList} from '../utils/format-branch.js'

type VcBranchFlowProps = CustomDialogCallbacks & {
  request: IVcBranchRequest
}

const LABELS: Record<VcBranchAction, string> = {
  create: 'Creating branch...',
  delete: 'Deleting branch...',
  list: 'Listing branches...',
}

export function VcBranchFlow({onCancel, onComplete, request}: VcBranchFlowProps): React.ReactNode {
  const branchMutation = useExecuteVcBranch()

  useInput((_, key) => {
    if (key.escape && !branchMutation.isPending) onCancel()
  })

  const fired = React.useRef(false)
  useEffect(() => {
    if (fired.current) return
    fired.current = true
    branchMutation.mutate(request, {
      onError(error) {
        onComplete(`Failed: ${formatTransportError(error)}`)
      },
      onSuccess(result) {
        if (result.action === 'list') {
          onComplete(formatBranchList(result.branches))
        } else if (result.action === 'create') {
          onComplete(`Created branch '${result.created}'.`)
        } else {
          onComplete(`Deleted branch '${result.deleted}'.`)
        }
      },
    })
  }, [])

  return (
    <Text>
      <Spinner type="dots" /> {LABELS[request.action]}
    </Text>
  )
}
