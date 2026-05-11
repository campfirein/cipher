import type {
  Channel,
  ChannelMeta,
  Turn,
  TurnDelivery,
  TurnEvent,
} from '../../../../shared/types/channel.js'

/**
 * Phase-1 channel persistence contract.
 *
 * The store is a thin facade over the storage layer
 * (`src/server/infra/channel/storage/`): it knows how to read and write
 * `meta.json` for channels and to durably append turn events. It does NOT
 * implement orchestrator policy (state-machine transitions, mention parsing,
 * snapshot lifecycle) — that lives in the orchestrator (Slice 1.4).
 *
 * Slice 1.4 wires a concrete implementation that composes
 * {@link ChannelEventsWriter}, {@link ChannelSnapshotWriter}, and
 * {@link ChannelTreeReader}.
 */

export type ChannelStoreCreateArgs = {
  readonly meta: ChannelMeta
  readonly projectRoot: string
}

export type ChannelStoreUpdateMetaArgs = {
  readonly channelId: string
  readonly mutate: (meta: ChannelMeta) => ChannelMeta
  readonly projectRoot: string
}

export type ChannelStoreReadArgs = {
  readonly channelId: string
  readonly projectRoot: string
}

export type ChannelStoreListArgs = {
  readonly includeArchived?: boolean
  readonly projectRoot: string
}

export type ChannelStoreAppendEventArgs = {
  readonly channelId: string
  readonly event: TurnEvent
  readonly projectRoot: string
  readonly turnId: string
}

export type ChannelStoreSnapshotArgs = {
  readonly channelId: string
  readonly projectRoot: string
  readonly turn: Turn
  readonly turnId: string
}

export type ChannelStoreListTurnsArgs = {
  readonly channelId: string
  readonly cursor?: string
  readonly limit?: number
  readonly projectRoot: string
}

export type ChannelStoreListTurnsResult = {
  readonly nextCursor?: string
  readonly turns: Turn[]
}

export type ChannelStoreReadTurnArgs = {
  readonly channelId: string
  readonly projectRoot: string
  readonly turnId: string
}

export type ChannelStoreReadTurnResult = {
  readonly deliveries?: TurnDelivery[]
  readonly events: TurnEvent[]
  readonly turn: Turn
}

// ─── Phase-2 delivery + message snapshot args ───────────────────────────────

export type ChannelStoreWriteDeliveryArgs = {
  readonly channelId: string
  readonly delivery: TurnDelivery
  readonly deliveryId: string
  readonly projectRoot: string
  readonly turnId: string
}

export type ChannelStoreWriteMessageArgs = {
  readonly body: string
  readonly channelId: string
  readonly deliveryId: string
  readonly projectRoot: string
  readonly turnId: string
}

export type ChannelStoreReadDeliveriesArgs = {
  readonly channelId: string
  readonly projectRoot: string
  readonly turnId: string
}

export interface IChannelStore {
  appendTurnEvent(args: ChannelStoreAppendEventArgs): Promise<void>
  createChannel(args: ChannelStoreCreateArgs): Promise<Channel>
  listChannels(args: ChannelStoreListArgs): Promise<Channel[]>
  listTurns(args: ChannelStoreListTurnsArgs): Promise<ChannelStoreListTurnsResult>
  readChannel(args: ChannelStoreReadArgs): Promise<Channel | undefined>
  /**
   * Phase-2 read path that returns the full `ChannelMeta` (discriminated-union
   * member records with `invocation`, `capabilities`, etc.). The summarised
   * wire `Channel` projection is still served by {@link readChannel}.
   */
  readChannelMeta(args: ChannelStoreReadArgs): Promise<ChannelMeta | undefined>
  /**
   * Phase-2 delivery read path. Returns the persisted `deliveries/<id>.json`
   * snapshots when present, otherwise replays them from `events.jsonl` via
   * the tree-reader. Returns `[]` when no events and no snapshots exist.
   */
  readDeliveries(args: ChannelStoreReadDeliveriesArgs): Promise<TurnDelivery[]>
  readTurn(args: ChannelStoreReadTurnArgs): Promise<ChannelStoreReadTurnResult | undefined>
  updateChannelMeta(args: ChannelStoreUpdateMetaArgs): Promise<Channel>
  /** Phase-2: persist a `deliveries/<id>.json` snapshot at terminal state. */
  writeDeliverySnapshot(args: ChannelStoreWriteDeliveryArgs): Promise<void>
  /** Phase-2: persist the rendered final message body for a delivery. */
  writeMessage(args: ChannelStoreWriteMessageArgs): Promise<void>
  writeTurnSnapshot(args: ChannelStoreSnapshotArgs): Promise<void>
}
