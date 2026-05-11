import type {RequestPermissionOutcome} from '../../../../shared/types/channel.js'
import type {IAcpDriver} from '../../../core/interfaces/channel/i-acp-driver.js'

import {
  ChannelPermissionAlreadyResolvedError,
  ChannelPermissionNotFoundError,
} from '../../../core/domain/channel/errors.js'

/**
 * Bridges ACP-side `session/request_permission` to the channel-event
 * surface (Slice 2.4).
 *
 * The broker is a pure registry:
 *  - {@link PermissionBroker.track} records the pending permission when the
 *    driver yields a `permission_request` payload.
 *  - {@link PermissionBroker.resolve} forwards the host's decision to the
 *    driver via `driver.respondToPermission` and returns the metadata the
 *    orchestrator needs to emit `delivery_state_change` +
 *    `permission_decision` events (with seq values from the per-turn
 *    sequence allocator).
 *  - {@link PermissionBroker.drainTurn} / {@link PermissionBroker.drainDelivery}
 *    cancel all pending permissions in scope (used by the cancel
 *    coordinator).
 *
 * Permissions are tracked in-memory; daemon restart loses them and the
 * orchestrator marks the affected delivery `errored`. Phase 3 hardens
 * this with persisted permission state.
 */
type PendingPermission = {
  channelId: string
  deliveryId: string
  driver: IAcpDriver
  turnId: string
}

export type PermissionBrokerTrackArgs = {
  channelId: string
  deliveryId: string
  driver: IAcpDriver
  permissionRequestId: string
  turnId: string
}

export type PermissionBrokerResolveArgs = {
  channelId: string
  outcome: RequestPermissionOutcome
  permissionRequestId: string
  turnId: string
}

export type PermissionBrokerResolveResult = {
  deliveryId: string
  isCancellation: boolean
}

export type PermissionBrokerDrainTurnArgs = {
  channelId: string
  turnId: string
}

export type PermissionBrokerDrainDeliveryArgs = {
  channelId: string
  deliveryId: string
  turnId: string
}

export type PermissionBrokerDrainResult = {
  deliveryId: string
  permissionRequestId: string
}

export interface IPermissionBroker {
  drainDelivery(args: PermissionBrokerDrainDeliveryArgs): Promise<PermissionBrokerDrainResult[]>
  drainTurn(args: PermissionBrokerDrainTurnArgs): Promise<PermissionBrokerDrainResult[]>
  resolve(args: PermissionBrokerResolveArgs): Promise<PermissionBrokerResolveResult>
  track(args: PermissionBrokerTrackArgs): void
}

export class PermissionBroker implements IPermissionBroker {
  private readonly pending = new Map<string, PendingPermission>()
  private readonly resolved = new Set<string>()

  async drainDelivery(args: PermissionBrokerDrainDeliveryArgs): Promise<PermissionBrokerDrainResult[]> {
    const targets: Array<[string, PendingPermission]> = []
    for (const [id, p] of this.pending) {
      if (p.channelId === args.channelId && p.turnId === args.turnId && p.deliveryId === args.deliveryId) {
        targets.push([id, p])
      }
    }

    return this.cancelPending(targets)
  }

  async drainTurn(args: PermissionBrokerDrainTurnArgs): Promise<PermissionBrokerDrainResult[]> {
    const targets: Array<[string, PendingPermission]> = []
    for (const [id, p] of this.pending) {
      if (p.channelId === args.channelId && p.turnId === args.turnId) targets.push([id, p])
    }

    return this.cancelPending(targets)
  }

  async resolve(args: PermissionBrokerResolveArgs): Promise<PermissionBrokerResolveResult> {
    const pending = this.pending.get(args.permissionRequestId)
    if (pending === undefined) {
      if (this.resolved.has(args.permissionRequestId)) {
        throw new ChannelPermissionAlreadyResolvedError(args.permissionRequestId)
      }

      throw new ChannelPermissionNotFoundError(args.permissionRequestId)
    }

    if (
      pending.channelId !== args.channelId ||
      pending.turnId !== args.turnId
    ) {
      throw new ChannelPermissionNotFoundError(args.permissionRequestId)
    }

    this.pending.delete(args.permissionRequestId)
    this.resolved.add(args.permissionRequestId)
    await pending.driver.respondToPermission(args.permissionRequestId, {outcome: args.outcome})
    return {
      deliveryId: pending.deliveryId,
      isCancellation: args.outcome.outcome === 'cancelled',
    }
  }

  track(args: PermissionBrokerTrackArgs): void {
    this.pending.set(args.permissionRequestId, {
      channelId: args.channelId,
      deliveryId: args.deliveryId,
      driver: args.driver,
      turnId: args.turnId,
    })
  }

  private async cancelPending(
    targets: Array<[string, PendingPermission]>,
  ): Promise<PermissionBrokerDrainResult[]> {
    const cancelled: PermissionBrokerDrainResult[] = []
    for (const [id, p] of targets) {
      this.pending.delete(id)
      this.resolved.add(id)
      // eslint-disable-next-line no-await-in-loop
      await p.driver.respondToPermission(id, {outcome: {outcome: 'cancelled'}})
      cancelled.push({deliveryId: p.deliveryId, permissionRequestId: id})
    }

    return cancelled
  }
}
