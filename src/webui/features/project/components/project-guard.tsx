import {Navigate, Outlet, useLocation} from 'react-router-dom'

import {useTransportStore} from '../../../stores/transport-store'

export function ProjectGuard() {
  const location = useLocation()
  const selectedProject = useTransportStore((s) => s.selectedProject)

  if (!selectedProject) {
    return <Navigate replace state={{from: location}} to="/projects" />
  }

  return <Outlet />
}
