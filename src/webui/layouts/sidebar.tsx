import { Button } from '@campfirein/byterover-packages/components/button'
import { useState } from 'react'

import { useAuthStore } from '../features/auth/stores/auth-store'
import { ProjectDropdown } from '../features/project/components/project-dropdown'
import { ProviderFlowDialog } from '../features/provider/components/provider-flow'

export function Sidebar() {
  const isAuthorized = useAuthStore((s) => s.isAuthorized)
  const userEmail = useAuthStore((s) => s.user?.email)
  const [providerDialogOpen, setProviderDialogOpen] = useState(false)

  return (
    <aside className="flex flex-col gap-6 p-6 border-r border-sidebar-border bg-sidebar">
      <div className="flex flex-col gap-2">
        <span className="text-xs tracking-widest uppercase text-muted-foreground">ByteRover Web UI</span>
        <h1 className="text-3xl leading-none">Control Room</h1>
        <ProjectDropdown />
      </div>

      <div className="mt-auto flex flex-col gap-2">
        <Button onClick={() => setProviderDialogOpen(true)} size="sm" variant="outline">
          Change Provider
        </Button>
        <ProviderFlowDialog onOpenChange={setProviderDialogOpen} open={providerDialogOpen} />

        {isAuthorized ? (
          <div className="flex flex-col gap-1 rounded-lg border border-border bg-card px-3 py-2.5">
            <span className="text-xs tracking-widest uppercase text-muted-foreground">Signed in</span>
            <span className="text-sm text-foreground truncate">{userEmail}</span>
          </div>
        ) : (
          <div className="flex flex-col gap-1 rounded-lg border border-border bg-card px-3 py-2.5">
            <span className="text-xs tracking-widest uppercase text-muted-foreground">Not signed in</span>
            <span className="text-sm text-muted-foreground">Sign in for full features</span>
          </div>
        )}
      </div>
    </aside>
  )
}
