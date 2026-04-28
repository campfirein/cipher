import {Badge} from '@campfirein/byterover-packages/components/badge'
import {Lightbulb} from 'lucide-react'

import {type ComposerType, HELP} from './task-composer-types'

export function HelpRow({type}: {type: ComposerType}) {
  return <p className="text-muted-foreground/60 text-xs">{HELP[type]}</p>
}

export function CurateAttachmentHint() {
  return (
    <p className="text-muted-foreground/60 mt-2 flex items-center gap-1.5 text-xs">
      <Lightbulb className="size-3 shrink-0" />
      <span>
        For file or folder attachments, use{' '}
        <code className="bg-muted text-foreground/80 mono rounded px-1.5 py-0.5 text-[11px]">
          brv curate -f &lt;path&gt;
        </code>{' '}
        from the CLI.
      </span>
    </p>
  )
}

export function PrefillBadge({label}: {label: string}) {
  return (
    <Badge
      // Bottom-left so the badge shares the textarea's reserved bottom band
      // with the keyboard hint (which lives at bottom-right) instead of
      // overlapping the first line of the prefilled example.
      className="text-primary-foreground absolute bottom-2 left-3 gap-1.5 px-2 text-[10px] tracking-[0.08em] uppercase"
      variant="secondary"
    >
      <span aria-hidden className="bg-primary-foreground size-1.5 rounded-full" />
      {label}
    </Badge>
  )
}
