import {expect} from 'chai'
import {createSandbox, type SinonSandbox, type SinonStubbedInstance} from 'sinon'

import {SessionMetadataStore} from '../../../../src/agent/infra/session/session-metadata-store.js'
import {resolveSessionId} from '../../../../src/server/infra/daemon/session-resolver.js'

// ============================================================================
// Helpers
// ============================================================================

function createStubStore(sandbox: SinonSandbox): SinonStubbedInstance<SessionMetadataStore> {
  // Create a real instance then stub all methods
  const store = sandbox.createStubInstance(SessionMetadataStore)
  return store
}

const NEW_SESSION_ID = 'agent-session-new-uuid'
const EXISTING_SESSION_ID = 'agent-session-existing-uuid'

const noop = (): void => {}

// ============================================================================
// Tests
// ============================================================================

describe('resolveSessionId', () => {
  let sandbox: SinonSandbox

  beforeEach(() => {
    sandbox = createSandbox()
  })

  afterEach(() => {
    sandbox.restore()
  })

  it('should return new session when no active session exists', async () => {
    const store = createStubStore(sandbox)
    store.getActiveSession.resolves(null)

    const result = await resolveSessionId({log: noop, metadataStore: store, newSessionId: NEW_SESSION_ID})

    expect(result).to.deep.equal({isResume: false, sessionId: NEW_SESSION_ID})
    expect(store.markSessionInterrupted.called).to.be.false
  })

  it('should resume stale session and mark it as interrupted', async () => {
    const store = createStubStore(sandbox)
    store.getActiveSession.resolves({
      activatedAt: new Date().toISOString(),
      pid: 99_999,
      processToken: 'old-token',
      sessionId: EXISTING_SESSION_ID,
    })
    store.isActiveSessionStale.resolves(true)
    store.markSessionInterrupted.resolves()

    const result = await resolveSessionId({log: noop, metadataStore: store, newSessionId: NEW_SESSION_ID})

    expect(result).to.deep.equal({isResume: true, sessionId: EXISTING_SESSION_ID})
    expect(store.markSessionInterrupted.calledOnceWith(EXISTING_SESSION_ID)).to.be.true
  })

  it('should return new session when active session is not stale (another process)', async () => {
    const store = createStubStore(sandbox)
    store.getActiveSession.resolves({
      activatedAt: new Date().toISOString(),
      pid: process.pid,
      processToken: 'live-token',
      sessionId: EXISTING_SESSION_ID,
    })
    store.isActiveSessionStale.resolves(false)

    const result = await resolveSessionId({log: noop, metadataStore: store, newSessionId: NEW_SESSION_ID})

    expect(result).to.deep.equal({isResume: false, sessionId: NEW_SESSION_ID})
    expect(store.markSessionInterrupted.called).to.be.false
  })

  it('should fall back to new session when getActiveSession throws', async () => {
    const store = createStubStore(sandbox)
    store.getActiveSession.rejects(new Error('disk read error'))

    const result = await resolveSessionId({log: noop, metadataStore: store, newSessionId: NEW_SESSION_ID})

    expect(result).to.deep.equal({isResume: false, sessionId: NEW_SESSION_ID})
  })

  it('should fall back to new session when isActiveSessionStale throws', async () => {
    const store = createStubStore(sandbox)
    store.getActiveSession.resolves({
      activatedAt: new Date().toISOString(),
      pid: 99_999,
      processToken: 'some-token',
      sessionId: EXISTING_SESSION_ID,
    })
    store.isActiveSessionStale.rejects(new Error('permission denied'))

    const result = await resolveSessionId({log: noop, metadataStore: store, newSessionId: NEW_SESSION_ID})

    expect(result).to.deep.equal({isResume: false, sessionId: NEW_SESSION_ID})
  })

  it('should still resume when markSessionInterrupted throws (non-blocking)', async () => {
    const store = createStubStore(sandbox)
    store.getActiveSession.resolves({
      activatedAt: new Date().toISOString(),
      pid: 99_999,
      processToken: 'old-token',
      sessionId: EXISTING_SESSION_ID,
    })
    store.isActiveSessionStale.resolves(true)
    store.markSessionInterrupted.rejects(new Error('write failed'))

    const result = await resolveSessionId({log: noop, metadataStore: store, newSessionId: NEW_SESSION_ID})

    expect(result).to.deep.equal({isResume: true, sessionId: EXISTING_SESSION_ID})
  })

  // ==========================================================================
  // Provider mismatch detection
  // ==========================================================================

  it('should NOT resume stale session when provider mismatches', async () => {
    const store = createStubStore(sandbox)
    store.getActiveSession.resolves({
      activatedAt: new Date().toISOString(),
      pid: 99_999,
      processToken: 'old-token',
      sessionId: EXISTING_SESSION_ID,
    })
    store.isActiveSessionStale.resolves(true)
    store.getSession.resolves({
      createdAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      messageCount: 5,
      providerId: 'byterover',
      sessionId: EXISTING_SESSION_ID,
      status: 'active',
      workingDirectory: '/tmp',
    })
    store.markSessionInterrupted.resolves()

    const result = await resolveSessionId({currentProviderId: 'anthropic', log: noop, metadataStore: store, newSessionId: NEW_SESSION_ID})

    expect(result).to.deep.equal({isResume: false, sessionId: NEW_SESSION_ID})
    expect(store.markSessionInterrupted.calledOnceWith(EXISTING_SESSION_ID)).to.be.true
  })

  it('should resume stale session when provider matches', async () => {
    const store = createStubStore(sandbox)
    store.getActiveSession.resolves({
      activatedAt: new Date().toISOString(),
      pid: 99_999,
      processToken: 'old-token',
      sessionId: EXISTING_SESSION_ID,
    })
    store.isActiveSessionStale.resolves(true)
    store.getSession.resolves({
      createdAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      messageCount: 5,
      providerId: 'anthropic',
      sessionId: EXISTING_SESSION_ID,
      status: 'active',
      workingDirectory: '/tmp',
    })
    store.markSessionInterrupted.resolves()

    const result = await resolveSessionId({currentProviderId: 'anthropic', log: noop, metadataStore: store, newSessionId: NEW_SESSION_ID})

    expect(result).to.deep.equal({isResume: true, sessionId: EXISTING_SESSION_ID})
  })

  it('should resume stale session when old session has no providerId (backward compat)', async () => {
    const store = createStubStore(sandbox)
    store.getActiveSession.resolves({
      activatedAt: new Date().toISOString(),
      pid: 99_999,
      processToken: 'old-token',
      sessionId: EXISTING_SESSION_ID,
    })
    store.isActiveSessionStale.resolves(true)
    store.getSession.resolves({
      createdAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      messageCount: 3,
      sessionId: EXISTING_SESSION_ID,
      status: 'active',
      workingDirectory: '/tmp',
    })
    store.markSessionInterrupted.resolves()

    const result = await resolveSessionId({currentProviderId: 'anthropic', log: noop, metadataStore: store, newSessionId: NEW_SESSION_ID})

    expect(result).to.deep.equal({isResume: true, sessionId: EXISTING_SESSION_ID})
  })

  it('should resume stale session when no currentProviderId is given', async () => {
    const store = createStubStore(sandbox)
    store.getActiveSession.resolves({
      activatedAt: new Date().toISOString(),
      pid: 99_999,
      processToken: 'old-token',
      sessionId: EXISTING_SESSION_ID,
    })
    store.isActiveSessionStale.resolves(true)
    store.markSessionInterrupted.resolves()

    const result = await resolveSessionId({log: noop, metadataStore: store, newSessionId: NEW_SESSION_ID})

    expect(result).to.deep.equal({isResume: true, sessionId: EXISTING_SESSION_ID})
    expect(store.getSession.called).to.be.false
  })

  it('should fall back to new session when getSession throws during provider check', async () => {
    const store = createStubStore(sandbox)
    store.getActiveSession.resolves({
      activatedAt: new Date().toISOString(),
      pid: 99_999,
      processToken: 'old-token',
      sessionId: EXISTING_SESSION_ID,
    })
    store.isActiveSessionStale.resolves(true)
    store.getSession.rejects(new Error('corrupted metadata'))

    const result = await resolveSessionId({currentProviderId: 'anthropic', log: noop, metadataStore: store, newSessionId: NEW_SESSION_ID})

    expect(result).to.deep.equal({isResume: false, sessionId: NEW_SESSION_ID})
  })
})
