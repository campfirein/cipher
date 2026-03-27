import {Badge} from '@campfirein/byterover-packages/components/badge'
import {CardDescription, CardTitle} from '@campfirein/byterover-packages/components/card'
import {Navigate, Outlet, useLocation} from 'react-router-dom'

import {useAuthStore} from '../stores/auth-store'

export function AuthGuard() {
  const location = useLocation()
  const isAuthorized = useAuthStore((state) => state.isAuthorized)
  const isLoadingInitial = useAuthStore((state) => state.isLoadingInitial)

  if (isLoadingInitial) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-center">
          <Badge className="rounded-sm border-blue-500/20 bg-blue-500/10 text-blue-600" variant="outline">Connecting</Badge>
          <CardTitle>Initializing ByteRover</CardTitle>
          <CardDescription>Waiting for transport and authentication state to settle.</CardDescription>
        </div>
      </div>
    )
  }

  if (!isAuthorized) {
    return <Navigate replace state={{from: location}} to="/login" />
  }

  return <Outlet />
}
