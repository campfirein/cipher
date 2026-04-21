import type { ReactNode } from 'react'

import { Button } from '@campfirein/byterover-packages/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@campfirein/byterover-packages/components/tooltip'
import { ArrowDown, ArrowUp, GitBranch, LoaderCircle, XCircle } from 'lucide-react'

interface BranchBarProps {
  ahead?: number
  behind?: number
  branch?: string
  hasTracking: boolean
  isAborting?: boolean
  isAuthenticated: boolean
  isPulling: boolean
  isPushing: boolean
  mergeInProgress?: boolean
  onAbortMerge?: () => void
  onPull: () => void
  onPush: () => void
}

const SIGN_IN_HINT = 'Please sign in to use sync feature'

function withSignInTooltip(node: ReactNode, label: string, isAuthenticated: boolean): ReactNode {
  if (isAuthenticated) return node
  return (
    <Tooltip>
      <TooltipTrigger render={<span tabIndex={0} />}>{node}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function BranchBar({
  ahead = 0,
  behind = 0,
  branch,
  hasTracking,
  isAborting = false,
  isAuthenticated,
  isPulling,
  isPushing,
  mergeInProgress = false,
  onAbortMerge,
  onPull,
  onPush,
}: BranchBarProps) {
  const busy = isPulling || isPushing || isAborting

  const pullTitle = isAuthenticated
    ? (hasTracking ? 'Pull from upstream' : 'No upstream tracking branch')
    : SIGN_IN_HINT
  const pushTitle = isAuthenticated
    ? (hasTracking ? 'Push to upstream' : 'Push and set upstream')
    : SIGN_IN_HINT

  const pullButton = (
    <Button
      className="h-7 gap-1 px-2 text-sm"
      disabled={busy || !hasTracking || !isAuthenticated}
      onClick={onPull}
      size="sm"
      title={pullTitle}
      variant="ghost"
    >
      {isPulling ? <LoaderCircle className="size-3.5 animate-spin" /> : <ArrowDown className="size-3.5" />}
      {behind > 0 && <span className="text-sm tabular-nums">{behind}</span>}
    </Button>
  )

  const pushButton = (
    <Button
      className="h-7 gap-1 px-2 text-sm"
      disabled={busy || !isAuthenticated}
      onClick={onPush}
      size="sm"
      title={pushTitle}
      variant="ghost"
    >
      {isPushing ? <LoaderCircle className="size-3.5 animate-spin" /> : <ArrowUp className="size-3.5" />}
      {ahead > 0 && <span className="text-sm tabular-nums">{ahead}</span>}
    </Button>
  )

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

        {withSignInTooltip(pullButton, SIGN_IN_HINT, isAuthenticated)}
        {withSignInTooltip(pushButton, SIGN_IN_HINT, isAuthenticated)}
      </div>
    </div>
  )
}
