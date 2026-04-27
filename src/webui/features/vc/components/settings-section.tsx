import type {ReactNode} from 'react'

import {formatError} from '../../../lib/error-messages'

type Props = {
  action?: ReactNode
  children?: ReactNode
  compact?: boolean
  description: string
  error?: unknown
  errorFallback?: string
  onRetry?: () => void
  title: string
}

export function SettingsSection({
  action,
  children,
  compact = false,
  description,
  error,
  errorFallback = 'Failed to load',
  onRetry,
  title,
}: Props) {
  const cardClass = compact
    ? 'bg-card flex flex-col gap-3 rounded-xl border px-4.5 py-3.5'
    : 'bg-card flex flex-col gap-4 rounded-xl border px-5 py-4'

  return (
    <div className="flex w-full flex-col gap-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <h2 className="text-foreground text-[0.95rem] font-semibold leading-tight">{title}</h2>
          <p className="text-muted-foreground mt-0.5 text-[0.8125rem] leading-snug">{description}</p>
        </div>
        {action}
      </div>

      {error ? (
        <p className="text-destructive text-sm">
          ✗ {formatError(error, errorFallback)}
          {onRetry && (
            <>
              {' · '}
              <button className="underline underline-offset-2" onClick={onRetry} type="button">
                retry
              </button>
            </>
          )}
        </p>
      ) : (
        children && <div className={cardClass}>{children}</div>
      )}
    </div>
  )
}
