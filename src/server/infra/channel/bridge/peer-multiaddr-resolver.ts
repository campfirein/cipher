/**
 * Phase 9 / Slice 9.6 — peer multiaddr resolver abstraction.
 *
 * The bridge needs to convert a libp2p `peer_id` into a current set
 * of dialable multiaddrs. Today the daemon only knows the
 * `ChannelMemberRemotePeer.multiaddr` field that was pinned at
 * invite time — if Bob's IP rotates, Alice's stored multiaddr goes
 * stale and mentions fail.
 *
 * The spec (§6.4 D2) locks **DHT as primary** + **ByteRover registry
 * as fallback** for resolution. Real DHT integration requires the
 * `@libp2p/kad-dht` package wired into the libp2p host, plus signed
 * peer-record publishing on an `announce_interval_hours` cadence.
 * That integration is operator-side opt-in (it changes the host's
 * network footprint), so 9.6 ships the INTERFACE only; a future
 * commit adds the kad-dht implementation behind the same seam.
 *
 * Until a real resolver is wired, the daemon uses
 * `NoopPeerMultiaddrResolver` which returns no addresses for any
 * peer_id. Callers must treat `resolve()` returning an empty array
 * as "no fresh multiaddrs available — fall back to the cached
 * member.multiaddr or surface a clear error to the operator."
 */

import type {RegistryClient} from './registry-client.js'

export type Multiaddr = string

export interface IPeerMultiaddrResolver {
  /**
   * Drop any in-memory caches and release any libp2p subscriptions.
   * Safe to call multiple times.
   */
  close(): Promise<void>
  /**
   * Publish (announce) the local install's current set of dialable
   * multiaddrs to the discovery layer. The real implementation will
   * sign a libp2p peer-record with the L1 install key. Called by
   * the daemon on a background timer per
   * `bridge.announce_interval_hours`.
   */
  publish(addrs: readonly Multiaddr[]): Promise<void>
  /**
   * Look up the current dialable multiaddrs for a peer_id. Returns
   * an empty array when:
   *   - the resolver has no knowledge of the peer (DHT query
   *     returned no records, registry returned 404, etc.)
   *   - the resolver is the no-op default
   *
   * Callers should not retry on empty — that's the resolver's job.
   */
  resolve(peerId: string): Promise<readonly Multiaddr[]>
}

export class NoopPeerMultiaddrResolver implements IPeerMultiaddrResolver {
  public async close(): Promise<void> {}

  public async publish(_addrs: readonly Multiaddr[]): Promise<void> {}

  public async resolve(_peerId: string): Promise<readonly Multiaddr[]> {
    return []
  }
}

/**
 * Phase 9 / Slice 9.6 + 9.7 — composite resolver that tries each
 * configured backend in priority order. Used to layer "DHT primary,
 * registry fallback" (spec §6.4 D2) without baking the policy into
 * either backend.
 *
 * Resolution: walks resolvers in order; returns the FIRST non-empty
 * result. When every backend returns empty, the composite returns
 * empty.
 *
 * Publish: fan-out to every backend; individual failures are caught
 * and swallowed so a broken registry doesn't prevent DHT publishing
 * (or vice-versa).
 */
export class CompositePeerMultiaddrResolver implements IPeerMultiaddrResolver {
  private readonly resolvers: readonly IPeerMultiaddrResolver[]

  public constructor(resolvers: readonly IPeerMultiaddrResolver[]) {
    this.resolvers = resolvers
  }

  public async close(): Promise<void> {
    await Promise.allSettled(this.resolvers.map((r) => r.close()))
  }

  public async publish(addrs: readonly Multiaddr[]): Promise<void> {
    await Promise.allSettled(this.resolvers.map((r) => r.publish(addrs)))
  }

  public async resolve(peerId: string): Promise<readonly Multiaddr[]> {
    for (const r of this.resolvers) {
      // eslint-disable-next-line no-await-in-loop
      const result = await r.resolve(peerId).catch(() => [] as readonly Multiaddr[])
      if (result.length > 0) return result
    }

    return []
  }
}

/**
 * Phase 9 / Slice 9.7 — adapter that wraps a `RegistryClient` to
 * satisfy the resolver interface. Publish is a no-op on the
 * registry side because registration is a separate operator-driven
 * step (`brv bridge register` ships in a later slice).
 */
export class RegistryPeerMultiaddrResolver implements IPeerMultiaddrResolver {
  private readonly client: RegistryClient

  public constructor(client: RegistryClient) {
    this.client = client
  }

  public async close(): Promise<void> {
    await this.client.close()
  }

  public async publish(_addrs: readonly Multiaddr[]): Promise<void> {
    // Registry publish flows through a separate CLI verb in the v1
    // story (operators consciously register their install); the
    // resolver does not auto-publish on every announce tick.
  }

  public async resolve(peerId: string): Promise<readonly Multiaddr[]> {
    const record = await this.client.lookupByPeerId(peerId)
    return record === undefined ? [] : record.multiaddrs
  }
}
