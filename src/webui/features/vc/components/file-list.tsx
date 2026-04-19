import type { MouseEvent } from 'react'

import { Button } from '@campfirein/byterover-packages/components/button'
import { ChevronDown, ChevronRight, FileDiff, Minus, Plus, Undo2 } from 'lucide-react'
import { useState } from 'react'

import type { ChangeFile } from '../types'

import { FileListItem } from './file-list-item'

function stopPropagation(event: MouseEvent) {
  event.stopPropagation()
}

interface FileListProps {
  /** Disable actions while mutations are pending. */
  disabled?: boolean
  files: ChangeFile[]
  /** Checks whether a file is the currently selected one. */
  isFileSelected?: (file: ChangeFile) => boolean
  label: string
  /** Discard unstaged changes on a single file (unstaged section only). */
  onDiscardFile?: (file: ChangeFile) => void
  /** Discard all unstaged changes in this section (unstaged section only). */
  onDiscardGroup?: () => void
  /** Action on a single file (stage or unstage). */
  onFileAction: (file: ChangeFile) => void
  /** Select a file to view its diff. */
  onFileSelect?: (file: ChangeFile) => void
  /** Action on all files in this section (optional). */
  onGroupAction?: () => void
  /** Open the multi-diff view showing every file in this section. */
  onOpenAll?: () => void
  /** Tooltip text for the "Open all" button. */
  openAllLabel?: string
  /** Whether the group action stages (shows `+`) or unstages (shows `-`). */
  variant: 'stage' | 'unstage'
}

export function FileList({
  disabled,
  files,
  isFileSelected,
  label,
  onDiscardFile,
  onDiscardGroup,
  onFileAction,
  onFileSelect,
  onGroupAction,
  onOpenAll,
  openAllLabel,
  variant,
}: FileListProps) {
  const [expanded, setExpanded] = useState(true)

  if (files.length === 0) return null

  const GroupIcon = variant === 'stage' ? Plus : Minus
  const ChevronIcon = expanded ? ChevronDown : ChevronRight

  return (
    <section className="flex flex-col">
      <div
        aria-expanded={expanded}
        className="h-8 group hover:bg-muted/50 flex cursor-pointer items-center justify-between rounded px-1 py-1.5 transition-colors"
        onClick={() => setExpanded((prev) => !prev)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            setExpanded((prev) => !prev)
          }
        }}
        role="button"
        tabIndex={0}
      >
        <div className="flex items-center gap-1">
          <ChevronIcon className="text-muted-foreground size-3.5" strokeWidth={2.5} />
          <h3 className="text-muted-foreground text-sm font-bold">{label}</h3>
          <span className="text-muted-foreground bg-muted ml-1 rounded px-1.5 py-0.5 text-xs font-medium">{files.length}</span>
        </div>
        <div className="flex items-center gap-1">
          {onOpenAll && (
            <Button
              className="size-5 opacity-0 transition-colors group-hover:opacity-100 focus:opacity-100 hover:bg-foreground/15 dark:hover:bg-foreground/15 hover:text-foreground disabled:opacity-0"
              onClick={(event) => {
                stopPropagation(event)
                onOpenAll()
              }}
              size="icon-xs"
              title={openAllLabel ?? 'Open all'}
              variant="ghost"
            >
              <FileDiff className="size-3" />
            </Button>
          )}
          {onDiscardGroup && (
            <Button
              className="size-5 opacity-0 transition-colors group-hover:opacity-100 focus:opacity-100 hover:bg-foreground/15 dark:hover:bg-foreground/15 hover:text-foreground disabled:opacity-0"
              disabled={disabled}
              onClick={(event) => {
                stopPropagation(event)
                onDiscardGroup()
              }}
              size="icon-xs"
              title="Discard all changes"
              variant="ghost"
            >
              <Undo2 className="size-3" />
            </Button>
          )}
          {onGroupAction && (
            <Button
              className="size-5 opacity-0 transition-colors group-hover:opacity-100 focus:opacity-100 hover:bg-foreground/15 dark:hover:bg-foreground/15 hover:text-foreground disabled:opacity-0"
              disabled={disabled}
              onClick={(event) => {
                stopPropagation(event)
                onGroupAction()
              }}
              size="icon-xs"
              title={variant === 'stage' ? 'Stage all' : 'Unstage all'}
              variant="ghost"
            >
              <GroupIcon className="size-3" />
            </Button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="flex flex-col">
          {files.map((file) => (
            <FileListItem
              disabled={disabled}
              file={file}
              isSelected={isFileSelected?.(file)}
              key={`${file.status === 'unmerged' ? 'merge' : file.isStaged ? 'staged' : 'unstaged'}:${file.path}`}
              onAction={onFileAction}
              onDiscard={onDiscardFile}
              onSelect={onFileSelect}
            />
          ))}
        </div>
      )}
    </section>
  )
}
