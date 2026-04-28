import {useProviderStore} from '../stores/provider-store'
import {ProviderFlowDialog} from './provider-flow'

/**
 * Store-backed mount of ProviderFlowDialog so any component can open it
 * without owning its own dialog state. Triggered via
 * `useProviderStore.getState().openProviderDialog()` (or a selector).
 * Existing local-state mounts (Header, TaskComposer, TourHost) keep working.
 */
export function GlobalProviderDialog() {
  const isOpen = useProviderStore((s) => s.isDialogOpen)
  const closeProviderDialog = useProviderStore((s) => s.closeProviderDialog)

  return <ProviderFlowDialog onOpenChange={(open) => !open && closeProviderDialog()} open={isOpen} />
}
