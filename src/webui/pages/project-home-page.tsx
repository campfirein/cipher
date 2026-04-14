import {Badge} from '@campfirein/byterover-packages/components/badge'
import {CardDescription, CardTitle} from '@campfirein/byterover-packages/components/card'
import {useEffect, useState} from 'react'

import {ClientEvents} from '../../shared/transport/events'
import {AuthInitializer} from '../features/auth/components/auth-initializer'
import {ProviderSubscriptionInitializer} from '../features/provider/components/provider-subscription-initializer'
import {MainLayout} from '../layouts/main-layout'
import {useTransportStore} from '../stores/transport-store'

export function ProjectHomePage() {
  const apiClient = useTransportStore((s) => s.apiClient)
  const selectedProject = useTransportStore((s) => s.selectedProject)
  const [isAssociated, setIsAssociated] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (!apiClient || !selectedProject) return

    setIsAssociated(false)
    setError(undefined)

    apiClient
      .request<{error?: string; success: boolean}>(ClientEvents.ASSOCIATE_PROJECT, {
        projectPath: selectedProject,
      })
      .then((result) => {
        if (result.success) {
          setIsAssociated(true)
        } else {
          setError(result.error ?? 'Failed to associate with project')
        }
      })
      .catch((error: unknown) => {
        setError(error instanceof Error ? error.message : 'Failed to associate with project')
      })
  }, [apiClient, selectedProject])

  if (error) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-center">
          <Badge className="rounded-sm border-destructive/20 bg-destructive/10 text-destructive" variant="outline">
            Error
          </Badge>
          <CardTitle>Project error</CardTitle>
          <CardDescription>{error}</CardDescription>
        </div>
      </div>
    )
  }

  if (!isAssociated) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-center">
          <Badge className="rounded-sm border-blue-500/20 bg-blue-500/10 text-blue-600" variant="outline">
            Loading
          </Badge>
          <CardTitle>Loading project</CardTitle>
          <CardDescription>Connecting to project...</CardDescription>
        </div>
      </div>
    )
  }

  return (
    <AuthInitializer>
      <ProviderSubscriptionInitializer />
      <MainLayout />
    </AuthInitializer>
  )
}
