import {Badge} from '@campfirein/byterover-packages/components/badge'
import {type LucideIcon, X} from 'lucide-react'

interface AttachmentChipProps {
  Icon: LucideIcon
  /** When provided, renders an inline remove button (interactive composer use). */
  onRemove?: () => void
  path: string
}

export function AttachmentChip({Icon, onRemove, path}: AttachmentChipProps) {
  return (
    <Badge
      className="bg-muted max-w-[20rem] gap-1.5 animate-in fade-in slide-in-from-bottom-1 duration-200"
      title={path}
      variant="outline"
    >
      <Icon className="text-muted-foreground" />
      <span className="mono truncate">{path}</span>
      {onRemove && (
        <button
          aria-label={`Remove ${path}`}
          className="text-muted-foreground/60 hover:bg-border hover:text-foreground inline-flex size-4 shrink-0 items-center justify-center rounded-full transition"
          onClick={onRemove}
          type="button"
        >
          <X className="size-2.5" />
        </button>
      )}
    </Badge>
  )
}
