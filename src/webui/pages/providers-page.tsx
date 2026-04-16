import { Button } from '@campfirein/byterover-packages/components/button'
import { useState } from 'react'

import { ProviderFlowDialog } from '../features/provider/components/provider-flow'
import { ProvidersPanel } from '../features/provider/components/providers-panel'

export function ProvidersPage() {
  const [dialogOpen, setDialogOpen] = useState(false)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button onClick={() => setDialogOpen(true)}>Change Provider</Button>
      </div>
      <ProvidersPanel />
      <ProviderFlowDialog onOpenChange={setDialogOpen} open={dialogOpen} />
    </div>
  )
}
