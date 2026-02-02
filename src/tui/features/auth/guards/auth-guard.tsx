import {Spinner} from '@inkjs/ui'
import React from 'react'
import {Navigate, Outlet} from 'react-router-dom'

import {useAuthStore} from '../stores/auth-store.js'

export function AuthGuard(): React.ReactNode {
  const isAuthorized = useAuthStore((s) => s.isAuthorized)
  const isLoadingInitial = useAuthStore((s) => s.isLoadingInitial)

  if (isLoadingInitial) {
    return <Spinner label="Loading..." />
  }

  if (!isAuthorized) {
    return <Navigate replace to="/login" />
  }

  return <Outlet />
}
