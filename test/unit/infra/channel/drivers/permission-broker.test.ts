import type {PermissionOption, RequestPermissionRequest} from '@agentclientprotocol/sdk'

import {expect} from 'chai'

import {PermissionExpiredError, UnknownPermissionRequestError} from '../../../../../src/server/core/domain/channel/errors.js'
import {PermissionBroker} from '../../../../../src/server/infra/channel/drivers/permission-broker.js'

const STANDARD_OPTIONS: PermissionOption[] = [
  {kind: 'allow_once', name: 'Allow once', optionId: 'allow_once_1'},
  {kind: 'allow_always', name: 'Allow always', optionId: 'allow_always_1'},
  {kind: 'reject_once', name: 'Reject once', optionId: 'reject_once_1'},
]

function makeRequest(toolCallId = 'tc-9', options: PermissionOption[] = STANDARD_OPTIONS): RequestPermissionRequest {
  return {
    options,
    sessionId: 'sess-1',
    toolCall: {
      kind: 'edit',
      rawInput: {},
      status: 'pending',
      title: 'Edit src/auth.ts',
      toolCallId,
    },
  }
}

describe('PermissionBroker', () => {
  it('parkAndAwait does not resolve until decide() is called', async () => {
    const broker = new PermissionBroker(60_000)
    let resolved = false
    const promise = broker.parkAndAwait('t-1', 'ch-1', makeRequest('tc-1')).then(() => { resolved = true })

    await new Promise<void>((resolve) => { setTimeout(resolve, 5) })
    expect(resolved).to.equal(false)

    broker.decide('ch-1', 't-1', 'tc-1', 'allow')
    await promise
    expect(resolved).to.equal(true)
  })

  it('decide("allow") picks the allow_once option by kind, not by literal optionId', async () => {
    const broker = new PermissionBroker(60_000)
    const promise = broker.parkAndAwait('t-2', 'ch-1', makeRequest('tc-2'))
    const result = broker.decide('ch-1', 't-2', 'tc-2', 'allow')
    expect(result.denied).to.equal(false)
    expect(result.response.outcome.outcome).to.equal('selected')
    if (result.response.outcome.outcome === 'selected') {
      expect(result.response.outcome.optionId).to.equal('allow_once_1')
    }

    const awaited = await promise
    expect(awaited.denied).to.equal(false)
  })

  it('decide("always") prefers allow_always over allow_once', async () => {
    const broker = new PermissionBroker(60_000)
    const promise = broker.parkAndAwait('t-3a', 'ch-1', makeRequest('tc-3a'))
    const result = broker.decide('ch-1', 't-3a', 'tc-3a', 'always')
    if (result.response.outcome.outcome === 'selected') {
      expect(result.response.outcome.optionId).to.equal('allow_always_1')
    }

    await promise
  })

  // Codex re-review (round 3) Finding 1 — decide('deny') must look up reject options by kind,
  // not by literal optionId. Vendor adapters use IDs like `reject_once_1`.
  it('decide("deny") picks a reject option by kind even when its optionId is non-literal', async () => {
    const customOptions: PermissionOption[] = [
      {kind: 'allow_once', name: 'Yes', optionId: 'yes_button'},
      {kind: 'reject_once', name: 'No thanks', optionId: 'reject_once_99'},
    ]
    const broker = new PermissionBroker(60_000)
    const promise = broker.parkAndAwait('t-vendor', 'ch-1', makeRequest('tc-vendor', customOptions))
    const result = broker.decide('ch-1', 't-vendor', 'tc-vendor', 'deny')
    expect(result.denied).to.equal(true)
    if (result.response.outcome.outcome === 'selected') {
      expect(result.response.outcome.optionId).to.equal('reject_once_99')
    }

    const awaited = await promise
    expect(awaited.denied).to.equal(true)
  })

  it('decide("deny") prefers reject_once over reject_always', async () => {
    const opts: PermissionOption[] = [
      {kind: 'allow_once', name: 'Allow', optionId: 'a'},
      {kind: 'reject_once', name: 'Reject', optionId: 'r1'},
      {kind: 'reject_always', name: 'Reject all', optionId: 'r2'},
    ]
    const broker = new PermissionBroker(60_000)
    const promise = broker.parkAndAwait('t-rej', 'ch-1', makeRequest('tc-rej', opts))
    const result = broker.decide('ch-1', 't-rej', 'tc-rej', 'deny')
    if (result.response.outcome.outcome === 'selected') {
      expect(result.response.outcome.optionId).to.equal('r1')
    }

    await promise
  })

  it('parkAndAwait rejects with PermissionExpiredError after the timeout', async () => {
    const broker = new PermissionBroker(20)
    let caught: unknown
    try {
      await broker.parkAndAwait('t-3', 'ch-1', makeRequest('tc-3'))
    } catch (error) {
      caught = error
    }

    expect(caught).to.be.instanceOf(PermissionExpiredError)
  })

  it('removes the parked entry after timeout', async () => {
    const broker = new PermissionBroker(15)
    try {
      await broker.parkAndAwait('t-4', 'ch-1', makeRequest('tc-4'))
    } catch {
      /* expected */
    }

    expect(broker.listPending('ch-1')).to.have.length(0)
  })

  it('decide() for an unknown (channel, turn, permissionRequest) throws UnknownPermissionRequestError', () => {
    const broker = new PermissionBroker(60_000)
    expect(() => broker.decide('ch-x', 'nope', 'tc-x', 'allow')).to.throw(UnknownPermissionRequestError)
  })

  it('listPending returns parked requests scoped to a channel', async () => {
    const broker = new PermissionBroker(60_000)
    broker.parkAndAwait('t-5', 'ch-A', makeRequest('tc-5')).catch(() => {/* may reject on cleanup */})
    broker.parkAndAwait('t-6', 'ch-B', makeRequest('tc-6')).catch(() => {/* may reject on cleanup */})
    expect(broker.listPending('ch-A')).to.have.length(1)
    expect(broker.listPending('ch-B')).to.have.length(1)
    expect(broker.listPending()).to.have.length(2)
    broker.decide('ch-A', 't-5', 'tc-5', 'allow')
    broker.decide('ch-B', 't-6', 'tc-6', 'allow')
  })

  it('PendingPermission projection carries permissionRequestId, toolName, rationale, turnId', async () => {
    const broker = new PermissionBroker(60_000)
    broker.parkAndAwait('t-7', 'ch-1', makeRequest('tc-7')).catch(() => {/* may reject on cleanup */})
    const [pending] = broker.listPending('ch-1')
    expect(pending).to.exist
    expect(pending.turnId).to.equal('t-7')
    expect(pending.channelId).to.equal('ch-1')
    expect(pending.permissionRequestId).to.equal('tc-7')
    expect(pending.toolName).to.equal('edit')
    expect(pending.rationale).to.equal('Edit src/auth.ts')
    broker.decide('ch-1', 't-7', 'tc-7', 'allow')
  })

  it('does not synthesise a fake response on timeout (rejection only)', async () => {
    const broker = new PermissionBroker(15)
    let resolved = false
    let rejected = false
    try {
      await broker.parkAndAwait('t-8', 'ch-1', makeRequest('tc-8')).then(() => { resolved = true })
    } catch {
      rejected = true
    }

    expect(resolved).to.equal(false)
    expect(rejected).to.equal(true)
  })

  // Codex F3 — compound key prevents cross-channel collisions on identical turnId/permissionRequestId.
  it('does not collide when two channels park identical turnIds + permissionRequestIds', async () => {
    const broker = new PermissionBroker(60_000)
    let resolvedA = false
    let resolvedB = false
    const promiseA = broker.parkAndAwait('t-001', 'ch-A', makeRequest('tc-A')).then(() => { resolvedA = true })
    const promiseB = broker.parkAndAwait('t-001', 'ch-B', makeRequest('tc-A')).then(() => { resolvedB = true })

    expect(broker.listPending()).to.have.length(2)

    broker.decide('ch-A', 't-001', 'tc-A', 'allow')
    await promiseA
    expect(resolvedA).to.equal(true)
    expect(resolvedB).to.equal(false)
    expect(broker.listPending()).to.have.length(1)

    broker.decide('ch-B', 't-001', 'tc-A', 'allow')
    await promiseB
    expect(resolvedB).to.equal(true)
  })
})
