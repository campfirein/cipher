import {CopyButton} from '@campfirein/byterover-packages/components/copy-button'

import {useTransportStore} from '../../../stores/transport-store'
import {StateCard, StatusPill, VersionStamp} from './state-card'

export function OfflineScreen({error}: {error?: Error | null}) {
  const isConfigError = error?.message.includes('Failed to fetch UI config')
  const reconnectCount = useTransportStore((s) => s.reconnectCount)

  const command = isConfigError ? 'brv restart' : 'brv webui'
  const title = isConfigError ? 'Web UI server not available' : 'ByteRover is not running'

  return (
    <StateCard
      body={
        <>
          <p className="text-muted-foreground text-sm leading-relaxed">
            {isConfigError ? (
              <>
                Could not load{' '}
                <code className="bg-muted text-foreground rounded px-1.5 py-0.5 font-mono text-xs">/api/ui-config</code>
                . The dev server may have stopped or moved to a different port. Restart it from your terminal:
              </>
            ) : (
              'Could not connect to the ByteRover daemon. Start it from your terminal:'
            )}
          </p>

          <div className="bg-muted mt-3 flex items-center justify-between gap-3 rounded-md px-3.5 py-2.5 font-mono text-xs">
            <span>
              <span className="text-muted-foreground">$</span> {command}
            </span>
            <CopyButton className="-mr-1" showCopiedText={false} textToCopy={command} />
          </div>
        </>
      }
      footer={
        <>
          {isConfigError ? (
            <span className="text-muted-foreground/80 text-xs">Refresh once the host is back.</span>
          ) : (
            <>
              <span aria-hidden className="bg-muted-foreground/60 size-1.5 animate-pulse rounded-full" />
              <span className="text-muted-foreground text-xs">
                Reconnecting<span className="opacity-60"> · attempt </span>
                <span className="text-foreground tabular-nums">{reconnectCount}</span>
              </span>
            </>
          )}
          <VersionStamp />
        </>
      }
      pill={
        <StatusPill tone={isConfigError ? 'destructive' : 'warn'}>
          {isConfigError ? 'Unreachable' : 'Offline'}
        </StatusPill>
      }
      title={title}
    />
  )
}
