import type {ReactNode} from 'react'

import {Badge} from '@campfirein/byterover-packages/components/badge'
import {cn} from '@campfirein/byterover-packages/lib/utils'

import logoUrl from '../../../assets/logo.svg'
import {useTransportStore} from '../../../stores/transport-store'

export type Tone = 'destructive' | 'info' | 'warn'

const TONE_CLASSES: Record<Tone, string> = {
  destructive: 'border-red-500/20 bg-red-500/10 text-red-600 dark:text-red-400',
  info: 'border-blue-500/20 bg-blue-500/10 text-blue-600 dark:text-blue-400',
  warn: 'border-orange-500/20 bg-orange-500/10 text-orange-600 dark:text-orange-400',
}

const DOT_COLOR: Record<Tone, string> = {
  destructive: 'bg-red-500',
  info: 'bg-blue-500',
  warn: 'bg-orange-500',
}

function ByteroverMark({className}: {className?: string}) {
  return <img alt="Byterover" className={className} src={logoUrl} />
}

export function StatusPill({children, tone}: {children: ReactNode; tone: Tone}) {
  return (
    <Badge className={cn('h-auto gap-1.5 px-2 py-0.5 text-[11px]', TONE_CLASSES[tone])} variant="outline">
      <span className={cn('relative size-1.5 rounded-full', DOT_COLOR[tone])}>
        <span className={cn('absolute inset-0 animate-ping rounded-full opacity-50', DOT_COLOR[tone])} />
      </span>
      {children}
    </Badge>
  )
}

export function VersionStamp() {
  const version = useTransportStore((s) => s.version)
  if (!version) return null
  return <span className="text-muted-foreground/70 ml-auto font-mono text-[10px]">v{version}</span>
}

export function StateCard({
  body,
  footer,
  pill,
  title,
}: {
  body: ReactNode
  footer?: ReactNode
  pill: ReactNode
  title: string
}) {
  return (
    <div className="bg-background fixed inset-0 flex items-center justify-center p-6">
      <div className="border-border bg-card text-card-foreground w-full max-w-md overflow-hidden rounded-xl border shadow-[0_1px_0_0_rgba(0,0,0,0.02),0_8px_28px_-10px_rgba(0,0,0,0.12)] dark:shadow-[0_1px_0_0_rgba(0,0,0,0.4),0_8px_32px_-10px_rgba(0,0,0,0.6)]">
        <div className="flex items-center justify-between gap-4 px-5 pt-4">
          <div className="inline-flex min-w-0 items-center gap-2.5">
            <ByteroverMark className="size-8" />
            <h2 className="text-sm leading-tight font-semibold">{title}</h2>
          </div>
          {pill}
        </div>

        <div className="px-5 pt-2 pb-4">{body}</div>

        {footer && (
          <div className="border-border bg-foreground/1.5 flex items-center gap-2 border-t px-5 py-2.5">{footer}</div>
        )}
      </div>
    </div>
  )
}
