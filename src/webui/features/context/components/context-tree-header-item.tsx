import { cn } from '@campfirein/byterover-packages/lib/utils'
import { ChevronsLeft, Home } from 'lucide-react'
import { type MouseEvent } from 'react'

import { useContextTree } from '../hooks/use-context-tree'

interface ContextTreeHeaderItemProps {
  onCollapseClick?: () => void
}

export function ContextTreeHeaderItem({onCollapseClick}: ContextTreeHeaderItemProps) {
  const {navigateHome, selectedPath} = useContextTree()
  const isActive = !selectedPath

  const handleCollapseClick = (e: MouseEvent) => {
    e.stopPropagation()
    onCollapseClick?.()
  }

  return (
    <div
      className={cn(
        'text-muted-foreground flex h-9 cursor-pointer items-center justify-between gap-2 rounded px-2 text-sm transition-colors hover:bg-neutral-800',
        { 'bg-background text-foreground': isActive },
      )}
      onClick={navigateHome}
    >
      <div className="flex items-center gap-2">
        <Home className="size-4" strokeWidth={2} />
        <span className="font-medium">All context</span>
      </div>
      {onCollapseClick && (
        <button
          className="text-muted-foreground hover:text-foreground flex cursor-pointer items-center rounded p-0.5 transition-colors hover:bg-neutral-700"
          onClick={handleCollapseClick}
          type="button"
        >
          <ChevronsLeft className="size-5" />
        </button>
      )}
    </div>
  )
}
