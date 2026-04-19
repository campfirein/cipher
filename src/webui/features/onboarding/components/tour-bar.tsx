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
 */
function useRightSheetWidth(): number {
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const update = () => {
      const sheets = document.querySelectorAll('[data-slot="sheet-content"][data-side="right"]')
      let maxWidth = 0
      for (const sheet of sheets) {
        const rect = sheet.getBoundingClientRect()
        if (rect.width > maxWidth) maxWidth = rect.width
      }

      setWidth((prev) => (prev === maxWidth ? prev : maxWidth))
    }

    update()
    const observer = new globalThis.MutationObserver(update)
    observer.observe(document.body, {
      attributeFilter: ['data-state', 'data-side', 'data-slot', 'class', 'style'],
      attributes: true,
      childList: true,
      subtree: true,
    })
    window.addEventListener('resize', update)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
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

  // When a right sheet is open, dock just to its left so the bar lives next
  // to the user's focus. Otherwise, center horizontally (more visible on wide
  // screens than a corner anchor).
  const sheetOpen = sheetWidth > 0
  const wrapperClass = sheetOpen
    ? 'pointer-events-none fixed bottom-4 z-100 flex'
    : 'pointer-events-none fixed inset-x-0 bottom-4 z-100 flex justify-center px-4'
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
