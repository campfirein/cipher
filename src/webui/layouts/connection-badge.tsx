import {Badge} from '@campfirein/byterover-packages/components/badge'

import {useTransport} from '../features/transport/hooks/use-transport'

const badgeClassName =
  {
    connected: 'rounded-sm border-transparent bg-primary/10 text-primary',
    connecting: 'rounded-sm border-destructive/20 bg-destructive/10 text-destructive',
    disconnected: 'rounded-sm border-destructive/20 bg-destructive/10 text-destructive',
    reconnecting: 'rounded-sm border-yellow-500/20 bg-yellow-500/10 text-yellow-600',
  } as const

export function ConnectionBadge() {
  const {connectionState} = useTransport()

  const label =
    connectionState === 'connected'
      ? 'Connected'
      : connectionState === 'reconnecting'
        ? 'Reconnecting'
        : connectionState === 'connecting'
          ? 'Connecting'
          : 'Disconnected'

  return (
    <Badge className={badgeClassName[connectionState]} variant="outline">
      {label}
    </Badge>
  )
}
