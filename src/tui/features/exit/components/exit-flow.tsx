/**
 * ExitFlow Component
 *
 * Confirms, then gracefully exits the Ink application.
 */

import {useApp} from 'ink'
import React from 'react'

import type {CustomDialogCallbacks} from '../../../types/commands.js'

import {InlineConfirm} from '../../../components/inline-prompts/inline-confirm.js'

type ExitFlowProps = Pick<CustomDialogCallbacks, 'onComplete'>

export function ExitFlow({onComplete}: ExitFlowProps): React.ReactNode {
  const {exit} = useApp()

  return (
    <InlineConfirm
      default={true}
      message="Exit ByteRover REPL"
      onConfirm={(confirmed) => {
        if (confirmed) {
          exit()
        } else {
          onComplete('Exit cancelled.')
        }
      }}
    />
  )
}
