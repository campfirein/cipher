import type {ReactNode} from 'react'

type Props = {
  action: ReactNode
  description: ReactNode
  title: ReactNode
}

export function CalloutRow({action, description, title}: Props) {
  return (
    <div className="border-border bg-muted/40 flex items-center justify-between gap-3 rounded-md border border-dashed px-3.5 py-2.5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-foreground text-sm font-medium">{title}</span>
        <span className="text-muted-foreground truncate text-xs">{description}</span>
      </div>
      {action}
    </div>
  )
}
