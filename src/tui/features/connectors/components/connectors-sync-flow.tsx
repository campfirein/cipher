import {Text, useInput} from 'ink'
import React, {useEffect} from 'react'

import type {CustomDialogCallbacks} from '../../../types/commands.js'

export function ConnectorsSyncFlow({onComplete}: CustomDialogCallbacks): React.ReactNode {
  useInput((_input, key) => {
    if (key.escape) {
      onComplete('')
    }
  })

  useEffect(() => {
    onComplete('Skill sync is temporarily disabled. Knowledge is now accumulated in the context tree experience domain.')
  }, [])

  return (
    <Text>Skill sync is temporarily disabled.</Text>
  )
}
