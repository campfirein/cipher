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
  'set-upstream': 'Setting upstream...',
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
        switch (result.action) {
        case 'create': {
          onComplete(`Created branch '${result.created}'.`)
        
        break;
        }

        case 'delete': {
          onComplete(`Deleted branch '${result.deleted}'.`)
        
        break;
        }

        case 'list': {
          onComplete(formatBranchList(result.branches))
        
        break;
        }

        case 'set-upstream': {
          onComplete(`Branch '${result.branch}' set up to track '${result.upstream}'.`)
        
        break;
        }
        // No default
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
