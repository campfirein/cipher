 
// PeerTreeCertificate fields mirror AMENDMENT_TOFU §A3.2 on-disk JSON
// shape and are intentionally snake_case.

import {generateKeyPairSync, KeyObject} from 'node:crypto'

import {InstallIdentityService} from './install-identity-service.js'
import {issuePeerTreeCertificate, type PeerTreeCertificate} from './peer-tree-signer.js'
import {generateTreeId} from './tree-id.js'

/**
 * Phase 9 / Slice 9.3b — in-memory L2 peer-tree identity provider.
 *
 * Holds a single L2 Ed25519 keypair + an L1-signed
 * `PeerTreeCertificate`. The identity is regenerated per process (no
 * disk persistence in slice 9.3) so daemons restarting will surface as
 * new tree_ids to remote peers. Persistence + per-context-tree binding
 * arrive in a later slice when L2 identities are wired into the
 * project store.
 *
 * Design: one service instance == one tree_id. Two instances
 * constructed against the same `InstallIdentityService` produce two
 * DIFFERENT L2 identities, which is intentional — the slice 9.3
 * mock-echo only needs a fresh L2 to sign response frames; it does not
 * need a globally-stable L2 binding.
 */

const FIVE_YEARS_MS = 5 * 365 * 24 * 60 * 60 * 1000

export interface PeerTreeIdentity {
  readonly cert: PeerTreeCertificate
  readonly privateKey: KeyObject
  readonly publicKey: KeyObject
  readonly treeId: string
}

export interface PeerTreeIdentityServiceDeps {
  readonly clock?: () => Date
  readonly install: InstallIdentityService
}

export class PeerTreeIdentityService {
  private cache: PeerTreeIdentity | undefined
  private readonly clock: () => Date
  private readonly install: InstallIdentityService

  public constructor(deps: PeerTreeIdentityServiceDeps) {
    this.install = deps.install
    this.clock = deps.clock ?? (() => new Date())
  }

  public async loadOrGenerate(): Promise<PeerTreeIdentity> {
    if (this.cache) return this.cache

    const {privateKey, publicKey} = generateKeyPairSync('ed25519')
    const pubJwk = publicKey.export({format: 'jwk'}) as {x?: string}
    if (typeof pubJwk.x !== 'string') {
      throw new TypeError('L2 Ed25519 KeyObject JWK is missing the `x` field')
    }

    const l2PubKey = Buffer.from(pubJwk.x, 'base64url').toString('base64')
    const treeId = generateTreeId()

    const installIdentity = await this.install.loadOrGenerate()
    const l1PubRaw = await this.install.getRawPublicKey()
    const l1PrivateKey = await this.install.getL1PrivateKey()

    const now = this.clock()
    const cert = issuePeerTreeCertificate({
      expiresAt: new Date(now.getTime() + FIVE_YEARS_MS),
      issuedAt: now,
      l1PeerId: installIdentity.peerId,
      l1PrivateKey,
      l1PubRaw,
      l2PubKey,
      treeId,
    })

    const identity: PeerTreeIdentity = {cert, privateKey, publicKey, treeId}
    this.cache = identity
    return identity
  }
}
