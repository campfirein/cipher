import {Navigate, Outlet, useLocation} from 'react-router-dom'

import {useTransportStore} from '../../../stores/transport-store'
import {AuthInitializer} from '../../auth/components/auth-initializer'
import {ProviderSubscriptionInitializer} from '../../provider/components/provider-subscription-initializer'
import {TaskSubscriptionInitializer} from '../../tasks/components/task-subscription-initializer'
import {ProjectAssociationInitializer} from './project-association-initializer'

export function ProjectGuard() {
  const location = useLocation()
  const selectedProject = useTransportStore((s) => s.selectedProject)

  if (!selectedProject) {
    return <Navigate replace state={{from: location}} to="/projects" />
  }

  return (
    <AuthInitializer>
      <ProjectAssociationInitializer />
      <ProviderSubscriptionInitializer />
      <TaskSubscriptionInitializer />
      <Outlet />
    </AuthInitializer>
  )
}
