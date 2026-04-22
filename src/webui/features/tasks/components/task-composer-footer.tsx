import {Button} from '@campfirein/byterover-packages/components/button'
import {Checkbox} from '@campfirein/byterover-packages/components/checkbox'

import type {ComposerType} from './task-composer-types'

export function ComposerFooter({
  canSubmit,
  hasActiveProvider,
  inTour,
  isPending,
  onClose,
  onOpenDetailChange,
  onSubmit,
  openDetailAfter,
  type,
}: {
  canSubmit: boolean
  hasActiveProvider: boolean
  inTour: boolean
  isPending: boolean
  onClose: () => void
  onOpenDetailChange: (next: boolean) => void
  onSubmit: () => Promise<void>
  openDetailAfter: boolean
  type: ComposerType
}) {
  const actionLabel = type === 'query' ? 'Query' : 'Curate'
  const pendingLabel = type === 'query' ? 'Querying…' : 'Curating…'
  const showActionLabel = inTour || hasActiveProvider
  const submitLabel = isPending ? pendingLabel : showActionLabel ? actionLabel : 'Connect provider…'

  return (
    <footer className="border-border flex items-center justify-between gap-3 border-t px-7 py-3.5">
      {inTour ? (
        <span />
      ) : (
        <label className="text-muted-foreground inline-flex cursor-pointer items-center gap-2 text-xs">
          <Checkbox checked={openDetailAfter} onCheckedChange={onOpenDetailChange} />
          Open after submit
        </label>
      )}
      <div className="ml-2 flex items-center gap-2">
        <Button onClick={onClose} size="sm" variant="ghost">
          Cancel
        </Button>
        <Button disabled={!canSubmit || isPending} onClick={onSubmit} size="sm">
          {submitLabel}
        </Button>
      </div>
    </footer>
  )
}
