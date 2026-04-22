import {cn} from '@campfirein/byterover-packages/lib/utils'
import {useEffect, useState} from 'react'

import {TOUR_STEPS, useOnboardingStore} from '../stores/onboarding-store'

const STEP_LABEL: Record<(typeof TOUR_STEPS)[number], string> = {
  connector: 'Connect to your AI tool',
  curate: 'Curate your first knowledge',
  provider: 'Connect a provider',
  query: 'Ask your first question',
}

/**
 * Tracks the width of any open right-side Sheet (composer, task detail, etc.)
 * so the tour bar can dock just to its left instead of being hidden under it.
 * Returns 0 when no right sheet is open.
 *
 * Uses a ResizeObserver on the matching sheet element(s) for live width
 * tracking, plus a narrow childList-only MutationObserver to catch sheets
 * being mounted/unmounted via base-ui's Portal. This avoids reacting to every
 * attribute mutation in the body subtree (the previous, expensive approach).
 */
function useRightSheetWidth(): number {
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const SHEET_SELECTOR = '[data-slot="sheet-content"][data-side="right"]'
    let resizeObserver: globalThis.ResizeObserver | null = null

    const measure = () => {
      const sheets = document.querySelectorAll(SHEET_SELECTOR)
      let maxWidth = 0
      for (const sheet of sheets) {
        const rect = sheet.getBoundingClientRect()
        if (rect.width > maxWidth) maxWidth = rect.width
      }

      setWidth((prev) => (prev === maxWidth ? prev : maxWidth))
    }

    const rebind = () => {
      resizeObserver?.disconnect()
      const sheets = document.querySelectorAll(SHEET_SELECTOR)
      if (sheets.length === 0) {
        measure()
        return
      }

      resizeObserver = new globalThis.ResizeObserver(measure)
      for (const sheet of sheets) resizeObserver.observe(sheet)
      measure()
    }

    // Detect sheet mount/unmount via Portal — childList only, no attribute
    // tracking, so we don't fire on every class/style change in the page.
    const portalObserver = new globalThis.MutationObserver(rebind)
    portalObserver.observe(document.body, {childList: true, subtree: true})

    rebind()

    return () => {
      resizeObserver?.disconnect()
      portalObserver.disconnect()
    }
  }, [])

  return width
}

export function TourBar() {
  const tourActive = useOnboardingStore((s) => s.tourActive)
  const tourStep = useOnboardingStore((s) => s.tourStep)
  const exitTour = useOnboardingStore((s) => s.exitTour)
  const sheetWidth = useRightSheetWidth()

  if (!tourActive || !tourStep) return null

  const idx = TOUR_STEPS.indexOf(tourStep)

  // Steps 2 (curate) + 3 (query) open a right-side sheet that fills full height,
  // so the bar moves to the top to stay visually clear of it. Steps 1 (provider)
  // and 4 (connector) use centered dialogs — bottom is the natural rest spot.
  const dockTop = tourStep === 'curate' || tourStep === 'query'
  const verticalAnchor = dockTop ? 'top-4' : 'bottom-4'

  // When a right sheet is open, anchor by the right edge so the bar sits next
  // to the sheet's left edge instead of being hidden under it.
  const sheetOpen = sheetWidth > 0
  const wrapperClass = cn(
    'pointer-events-none fixed z-100 flex',
    verticalAnchor,
    sheetOpen ? '' : 'inset-x-0 justify-center px-4',
  )
  const wrapperStyle = sheetOpen ? {right: `${sheetWidth + 16}px`} : undefined

  return (
    <div className={wrapperClass} style={wrapperStyle}>
      <div className="border-border bg-card text-card-foreground pointer-events-auto inline-flex items-center gap-3 rounded-full border px-3 py-2 pl-3.5 shadow-[0_8px_28px_-10px_rgba(0,0,0,0.25)]">
        <div className="inline-flex items-center gap-1">
          {TOUR_STEPS.map((step, i) => (
            <span
              aria-hidden
              className={cn(
                'h-1.5 rounded-full transition-all',
                i < idx && 'bg-muted-foreground w-1.5',
                i === idx && 'bg-primary-foreground w-4',
                i > idx && 'bg-border w-1.5',
              )}
              key={step}
            />
          ))}
        </div>

        <span className="text-foreground text-xs font-medium">
          <span className="text-muted-foreground mono mr-1.5 text-[10.5px]">
            {idx + 1}/{TOUR_STEPS.length}
          </span>
          {STEP_LABEL[tourStep]}
        </span>

        <span aria-hidden className="bg-border h-4 w-px" />

        <button
          className="text-muted-foreground hover:text-foreground cursor-pointer rounded px-1.5 py-0.5 text-[11px] transition-colors"
          onClick={() => exitTour()}
          type="button"
        >
          Exit tour
        </button>
      </div>
    </div>
  )
}
