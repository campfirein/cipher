/* eslint-disable camelcase */
// Wire fields use snake_case (AMENDMENT_TOFU §A3.2).

import {expect} from 'chai'

import type {KnownPeer} from '../../../../../../src/agent/core/trust/tofu-store.js'

import {isL2CertExpired} from '../../../../../../src/server/infra/channel/bridge/identity-client.js'

// Phase 9 / Slice 9.4h — cached L2 cert expiry check.
//
// Background: 9.4d's TOFU fast-path returns `KnownPeer.l2_pub_key`
// without consulting any expires_at, so a stale (expired) L2 cert is
// happily reused for years. 9.4h adds `KnownPeer.l2_expires_at` and
// an `isL2CertExpired` helper used by the daemon's
// `resolveRemotePeerL2PubKey` to fall through to a fresh `fetchAndPin`
// when the cached cert has expired.

const buildPeer = (overrides: Partial<KnownPeer> = {}): KnownPeer => ({
  first_seen_at: '2026-05-19T00:00:00.000Z',
  install_cert_fingerprint: 'a'.repeat(64),
  last_seen_at: '2026-05-19T00:00:00.000Z',
  peer_id: '12D3KooWAlice',
  pin_state: 'user-confirmed',
  ...overrides,
})

describe('isL2CertExpired (slice 9.4h)', () => {
  const now = new Date('2026-05-19T00:00:00.000Z')

  it('returns false when the cached cert is still valid', () => {
    const peer = buildPeer({
      l2_expires_at: '2027-05-19T00:00:00.000Z',
      l2_pub_key: 'AA'.repeat(22),
    })
    expect(isL2CertExpired(peer, now)).to.equal(false)
  })

  it('returns true when the cached cert has expired', () => {
    const peer = buildPeer({
      l2_expires_at: '2026-05-18T00:00:00.000Z',
      l2_pub_key: 'AA'.repeat(22),
    })
    expect(isL2CertExpired(peer, now)).to.equal(true)
  })

  it('returns true at the exact expiry boundary (expires_at <= now)', () => {
    const peer = buildPeer({
      l2_expires_at: '2026-05-19T00:00:00.000Z',
      l2_pub_key: 'AA'.repeat(22),
    })
    expect(isL2CertExpired(peer, now)).to.equal(true)
  })

  it('returns true (treat as expired) when l2_pub_key is set but l2_expires_at is missing — pre-9.4h legacy entries are stale-unknown', () => {
    // Forces a re-fetch on next use so the operator gets fresh
    // cert validation. Worst case is one extra dial; best case is
    // we catch a peer whose L2 cert silently expired.
    const peer = buildPeer({
      l2_pub_key: 'AA'.repeat(22),
    })
    expect(isL2CertExpired(peer, now)).to.equal(true)
  })

  it('returns false when there is no cached l2_pub_key — nothing to mark stale', () => {
    const peer = buildPeer()
    expect(isL2CertExpired(peer, now)).to.equal(false)
  })

  it('returns true when l2_expires_at is unparseable', () => {
    const peer = buildPeer({
      l2_expires_at: 'not-a-date',
      l2_pub_key: 'AA'.repeat(22),
    })
    expect(isL2CertExpired(peer, now)).to.equal(true)
  })
})
