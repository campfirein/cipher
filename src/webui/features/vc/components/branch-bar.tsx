import { Button } from '@campfirein/byterover-packages/components/button'
import { ArrowDown, ArrowUp, GitBranch, LoaderCircle, XCircle } from 'lucide-react'

interface BranchBarProps {
  ahead?: number
  behind?: number
  branch?: string
  hasTracking: boolean
  isAborting?: boolean
  isPulling: boolean
  isPushing: boolean
  mergeInProgress?: boolean
  onAbortMerge?: () => void
  onPull: () => void
  onPush: () => void
}

export function BranchBar({
  ahead = 0,
  behind = 0,
  branch,
  hasTracking,
  isAborting = false,
  isPulling,
  isPushing,
  mergeInProgress = false,
  onAbortMerge,
  onPull,
  onPush,
}: BranchBarProps) {
  const busy = isPulling || isPushing || isAborting

  return (
    <div className="flex items-center justify-between gap-2">
      <div className="text-muted-foreground flex min-w-0 items-center gap-1.5">
        <GitBranch className="size-4 shrink-0" />
        <span className="truncate text-sm font-medium">{branch ?? '(detached)'}</span>
      </div>

      <div className="flex items-center gap-0.5">
        {mergeInProgress && onAbortMerge && (
          <Button
            className="text-destructive h-7 gap-1 px-2 text-sm hover:bg-destructive/10 hover:text-destructive"
            disabled={busy}
            onClick={onAbortMerge}
            size="sm"
            title="Abort merge"
            variant="ghost"
          >
            {isAborting ? <LoaderCircle className="size-3.5 animate-spin" /> : <XCircle className="size-3.5" />}
            <span>Abort</span>
          </Button>
        )}

        <Button
          className="h-7 gap-1 px-2 text-sm"
          disabled={busy || !hasTracking}
          onClick={onPull}
          size="sm"
          title={hasTracking ? 'Pull from upstream' : 'No upstream tracking branch'}
          variant="ghost"
        >
          {isPulling ? <LoaderCircle className="size-3.5 animate-spin" /> : <ArrowDown className="size-3.5" />}
          {behind > 0 && <span className="text-sm tabular-nums">{behind}</span>}
        </Button>

        <Button
          className="h-7 gap-1 px-2 text-sm"
          disabled={busy}
          onClick={onPush}
          size="sm"
          title={hasTracking ? 'Push to upstream' : 'Push and set upstream'}
          variant="ghost"
        >
          {isPushing ? <LoaderCircle className="size-3.5 animate-spin" /> : <ArrowUp className="size-3.5" />}
          {ahead > 0 && <span className="text-sm tabular-nums">{ahead}</span>}
        </Button>
      </div>
    </div>
  )
}
