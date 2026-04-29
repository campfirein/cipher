import {Button} from '@campfirein/byterover-packages/components/button'
import {GitBranch} from 'lucide-react'
import {toast} from 'sonner'

import {useVcInit} from '../api/execute-vc-init'

export function InitializeVcButton() {
  const init = useVcInit()

  async function handleInit() {
    try {
      const result = await init.mutateAsync()
      toast.success(result.reinitialized ? 'Reinitialized version control' : 'Initialized version control')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to initialize')
    }
  }

  return (
    <Button
      disabled={init.isPending}
      onClick={() => {
        handleInit().catch(() => {})
      }}
      size="sm"
      variant="outline"
    >
      <GitBranch className="size-4 shrink-0" />
      <span>{init.isPending ? 'Initializing…' : 'Initialize Version Control'}</span>
    </Button>
  )
}
