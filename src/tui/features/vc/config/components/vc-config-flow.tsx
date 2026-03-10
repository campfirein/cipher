import {Text, useInput} from 'ink'
import Spinner from 'ink-spinner'
import React, {useEffect} from 'react'

import type {VcConfigKey} from '../../../../../shared/transport/events/vc-events.js'
import type {CustomDialogCallbacks} from '../../../../types/commands.js'

import {useExecuteVcConfig} from '../api/execute-vc-config.js'

type VcConfigFlowProps = CustomDialogCallbacks & {
  configKey: VcConfigKey
  value?: string
}

export function VcConfigFlow({configKey, onCancel, onComplete, value}: VcConfigFlowProps): React.ReactNode {
  const configMutation = useExecuteVcConfig()

  useInput((_, key) => {
    if (key.escape && !configMutation.isPending) {
      onCancel()
    }
  })

  useEffect(() => {
    configMutation.mutate(
      {key: configKey, value},
      {
        onError(error) {
          onComplete(`Failed: ${error.message}`)
        },
        onSuccess(result) {
          onComplete(`${result.key} = ${result.value}`)
        },
      },
    )
  }, [])

  const action = value === undefined ? 'Getting' : 'Setting'

  return (
    <Text>
      <Spinner type="dots" /> {action} {configKey}...
    </Text>
  )
}
