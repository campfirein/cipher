import {Spinner} from '@inkjs/ui'
import React from 'react'
import {Outlet} from 'react-router-dom'

import {useAuthStore} from '../stores/auth-store.js'

export function AuthGuard(): React.ReactNode {
  const isLoadingInitial = useAuthStore((s) => s.isLoadingInitial)

  if (isLoadingInitial) {
    return <Spinner label="Initializing..." />
  }

  return <Outlet />
}
