import {Badge} from '@campfirein/byterover-packages/components/badge'

/**
 * Single source of truth for the "Step N of M" pill rendered at the top of
 * each tour-driven dialog/sheet. Keeping it in one place means the four tour
 * steps stay visually identical instead of drifting into bespoke styling.
 */
export function TourStepBadge({label}: {label: string}) {
  return (
    <Badge
      // `leading-none` collapses the line-height to the glyph height so the
      // 10px label centers cleanly inside the 24px (h-6) pill instead of
      // sitting on the default text baseline.
      className="mono border-primary-foreground bg-primary-foreground/20 inline-flex h-6 w-fit items-center gap-1 px-2 text-[10px] leading-none tracking-[0.08em] uppercase"
      variant="outline"
    >
      {label}
    </Badge>
  )
}
