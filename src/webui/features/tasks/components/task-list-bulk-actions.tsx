import {Button} from '@campfirein/byterover-packages/components/button'

export function BulkActionsBar({
  canDelete,
  count,
  onClear,
  onDelete,
}: {
  canDelete: boolean
  count: number
  onClear: () => void
  onDelete: () => void
}) {
  return (
    <div className="border-border bg-muted/40 flex min-h-9 items-center gap-3 rounded-md border px-3 text-xs">
      <span className="text-foreground">
        <span className="text-foreground mono tabular-nums font-medium">{count}</span> selected
      </span>
      <span className="bg-border h-4 w-px" />
      <Button disabled={!canDelete} onClick={onDelete} size="xs" variant="ghost">
        Delete
      </Button>
      <Button className="ml-auto" onClick={onClear} size="xs" variant="ghost">
        Clear selection
      </Button>
    </div>
  )
}
