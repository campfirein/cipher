import {StateCard, StatusPill, VersionStamp} from './state-card'

export function ConnectingScreen() {
  return (
    <StateCard
      body={
        <p className="text-muted-foreground text-sm leading-relaxed">
          Establishing a connection to the ByteRover daemon. This usually takes less than a second.
        </p>
      }
      footer={
        <>
          <span aria-hidden className="bg-blue-500/70 size-1.5 animate-pulse rounded-full" />
          <span className="text-muted-foreground text-xs">Waiting for the daemon…</span>
          <VersionStamp />
        </>
      }
      pill={<StatusPill tone="info">Connecting</StatusPill>}
      title="Connecting to ByteRover"
    />
  )
}
