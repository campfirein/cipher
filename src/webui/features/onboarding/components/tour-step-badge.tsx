import {Badge} from '@campfirein/byterover-packages/components/badge'

/**
 * Single source of truth for the "Step N of M" pill rendered at the top of
 * each tour-driven dialog/sheet. Keeping it in one place means the four tour
 * steps stay visually identical instead of drifting into bespoke styling.
 */
export function TourStepBadge({label}: {label: string}) {
  return (
    <Badge
      className="mono border-primary-foreground bg-primary-foreground/20 h-6 w-fit gap-1 px-2 text-[10px] tracking-[0.08em] uppercase"
      variant="outline"
    >
      {label}
    </Badge>
  )
}
