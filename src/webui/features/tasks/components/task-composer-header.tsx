import {Tooltip, TooltipContent, TooltipTrigger} from '@campfirein/byterover-packages/components/tooltip'
import {cn} from '@campfirein/byterover-packages/lib/utils'

import type {ComposerType} from './task-composer-types'

import {TourStepBadge} from '../../onboarding/components/tour-step-badge'

export function ComposerHeader({
  inTour,
  onTypeChange,
  projectPath,
  tourStepLabel,
  type,
}: {
  inTour: boolean
  onTypeChange: (next: ComposerType) => void
  projectPath: string
  tourStepLabel?: string
  type: ComposerType
}) {
  return (
    <header className="border-border flex flex-col gap-2 border-b px-7 pt-5 pb-4">
      {tourStepLabel && <TourStepBadge label={tourStepLabel} />}
      <div className="flex items-center justify-between gap-4 pr-10">
        <h2 className="text-foreground flex items-baseline gap-1.5 text-lg font-medium tracking-tight">
          <span className="text-muted-foreground/70 font-normal">New</span>
          <span>{type} task</span>
        </h2>
        {/*
          During the tour the slider is shown but locked so users still learn
          the affordance — it'd otherwise be invisible until they finish the
          tour. Tooltip explains the disabled state.
        */}
        {inTour ? (
          <Tooltip>
            <TooltipTrigger render={<TypeSlider disabled onChange={onTypeChange} value={type} />} />
            <TooltipContent>Locked during the tour — the next step covers the other mode.</TooltipContent>
          </Tooltip>
        ) : (
          <TypeSlider onChange={onTypeChange} value={type} />
        )}
      </div>
      <p className="text-muted-foreground/70 text-xs">
        {type === 'query' ? 'Searches' : 'Will dispatch to'}{' '}
        <span className="text-identifier mono">{projectPath || '(no project selected)'}</span>
      </p>
    </header>
  )
}

function TypeSlider({
  disabled = false,
  onChange,
  value,
}: {
  disabled?: boolean
  onChange: (next: ComposerType) => void
  value: ComposerType
}) {
  return (
    <div
      aria-disabled={disabled}
      className={cn('border-border bg-muted relative inline-flex rounded-md border p-0.5', disabled && 'opacity-60')}
    >
      <span
        aria-hidden
        className={cn(
          'bg-background border-border absolute top-0.5 bottom-0.5 w-[calc(50%-2px)] rounded border transition-transform duration-200 ease-out',
          value === 'query' ? 'translate-x-full' : 'translate-x-0',
        )}
      />
      {(['curate', 'query'] as const).map((option) => (
        <button
          className={cn(
            'relative z-10 px-3 py-1 text-xs font-medium transition-colors',
            option === value ? 'text-foreground' : 'text-muted-foreground hover:text-foreground/80',
            disabled && 'cursor-not-allowed hover:text-muted-foreground',
          )}
          disabled={disabled}
          key={option}
          onClick={() => onChange(option)}
          type="button"
        >
          {option === 'curate' ? 'Curate' : 'Query'}
        </button>
      ))}
    </div>
  )
}
