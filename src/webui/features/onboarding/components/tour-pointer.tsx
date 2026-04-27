import {cn} from '@campfirein/byterover-packages/lib/utils'
import {type ReactNode} from 'react'

type Side = 'bottom' | 'top'
type Align = 'center' | 'end' | 'start'

type Props = {
  /**
   * When false the wrapped child is rendered untouched, so callers can drop
   * <TourPointer> into existing markup without conditionals.
   */
  active: boolean
  align?: Align
  children: ReactNode
  className?: string
  label: string
  side?: Side
}

/**
 * A gentle curved arrow connecting the label to the highlighted target.
 * Hand-drawn feel — slightly bowed line + arrowhead, ~32px long so the
 * label has room to breathe above/below the target.
 */
type CurveFrom = 'left' | 'right'

function CurvedArrow({
  className,
  curveFrom,
  direction,
}: {
  className?: string
  curveFrom: CurveFrom
  direction: 'down' | 'up'
}) {
  // The stick's source side flips so it always curves from where the label
  // sits toward the target's tip — otherwise the curve "points away" from
  // the label and the assembly looks disjointed.
  const fromRight = curveFrom === 'right'
  return (
    <svg
      aria-hidden
      className={cn('h-12 w-6', className)}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 24 48"
    >
      {direction === 'up' ? (
        fromRight ? (
          <>
            <path d="M 18 46 Q 4 30 12 4" stroke="currentColor" />
            <path d="M 7 9 L 12 4 L 13 11" stroke="currentColor" />
          </>
        ) : (
          <>
            <path d="M 6 46 Q 20 30 12 4" stroke="currentColor" />
            <path d="M 11 11 L 12 4 L 17 9" stroke="currentColor" />
          </>
        )
      ) : fromRight ? (
        <>
          <path d="M 18 2 Q 4 18 12 44" stroke="currentColor" />
          <path d="M 7 39 L 12 44 L 13 37" stroke="currentColor" />
        </>
      ) : (
        <>
          <path d="M 6 2 Q 20 18 12 44" stroke="currentColor" />
          <path d="M 11 37 L 12 44 L 17 39" stroke="currentColor" />
        </>
      )}
    </svg>
  )
}

/**
 * Onboarding coachmark. Wraps a target with a soft primary-tinted glow,
 * with a small label connected by a curved arrow that points at the
 * highlighted control. Static — attention comes from the glow + the
 * directional arrow rather than motion.
 */
export function TourPointer({active, align = 'center', children, className, label, side = 'bottom'}: Props) {
  if (!active) return <>{children}</>

  // Arrow stick curves from the same side as the label so the assembly
  // reads as one piece. For centered alignment we default the curve to the
  // right (it's a self-contained vertical stack so either looks fine).
  const curveFrom: CurveFrom = align === 'end' ? 'left' : 'right'

  return (
    // z-50 lifts the target above the page-wide TourBackdrop (z-40) so the
    // highlighted control stays sharp while everything else fades back.
    <span className={cn('relative z-50 inline-flex', className)}>
      <span className="rounded-md shadow-[0_0_0_2px_var(--primary-foreground),0_0_24px_4px_color-mix(in_oklch,var(--primary-foreground)_45%,transparent)]">
        {children}
      </span>

      {/* Arrow always pinned to the target's horizontal center so the tip
          lands on the highlighted control. */}
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute left-1/2 -translate-x-1/2',
          side === 'bottom' ? 'top-full mt-1' : 'bottom-full mb-1',
        )}
      >
        <CurvedArrow curveFrom={curveFrom} direction={side === 'bottom' ? 'up' : 'down'} />
      </span>

      {/* Label aligned independently — for `align="end"` the label sits to
          the left of the arrow tail, etc. — so the assembly never overflows
          past the target's edge. */}
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute',
          side === 'bottom' ? 'top-[calc(100%+3.25rem)]' : 'bottom-[calc(100%+3.25rem)]',
          align === 'start' && 'left-0',
          align === 'center' && 'left-1/2 -translate-x-1/2',
          align === 'end' && 'right-0',
        )}
      >
        <span className="text-xl whitespace-nowrap font-medium tracking-wide leading-tight">{label}</span>
      </span>
    </span>
  )
}
