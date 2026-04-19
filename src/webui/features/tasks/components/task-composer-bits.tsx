import {Badge} from '@campfirein/byterover-packages/components/badge'

import {type ComposerType, HELP} from './task-composer-types'

export function HelpRow({hasContent, type}: {hasContent: boolean; type: ComposerType}) {
  return (
    <p className="text-muted-foreground/60 flex items-center gap-2 text-xs">
      <span>{HELP[type]}</span>
      {!hasContent && (
        <span className="text-muted-foreground/50 ml-auto">
          <kbd className="bg-muted text-foreground/70 mono rounded px-1.5 py-0.5 text-[10px]">Tab</kbd> to use example
        </span>
      )}
    </p>
  )
}

export function CurateAttachmentHint() {
  return (
    <p className="text-muted-foreground/60 mt-2 text-xs">
      For file or folder attachments, use{' '}
      <code className="bg-muted text-foreground/80 mono rounded px-1.5 py-0.5 text-[11px]">
        brv curate -f &lt;path&gt;
      </code>{' '}
      from the CLI.
    </p>
  )
}

export function PrefillBadge({label}: {label: string}) {
  return (
    <Badge
      className="text-primary-foreground absolute top-2.5 right-3 gap-1.5 px-2 text-[10px] tracking-[0.08em] uppercase"
      variant="secondary"
    >
      <span aria-hidden className="bg-primary-foreground size-1.5 rounded-full" />
      {label}
    </Badge>
  )
}
