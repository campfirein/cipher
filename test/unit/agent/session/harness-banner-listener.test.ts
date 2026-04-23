import {expect} from 'chai'
import sinon from 'sinon'

import {AgentEventBus} from '../../../../src/agent/infra/events/event-emitter.js'
import {HarnessBannerListener} from '../../../../src/agent/infra/session/harness-banner-listener.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAcceptedEvent(overrides: {
  commandType?: string
  fromHeuristic?: number
  fromVersion?: number
  projectId?: string
  toHeuristic?: number
  toVersion?: number
} = {}) {
  return {
    accepted: true as const,
    commandType: overrides.commandType ?? 'curate',
    fromHeuristic: overrides.fromHeuristic ?? 0.58,
    fromVersion: overrides.fromVersion ?? 3,
    projectId: overrides.projectId ?? 'proj-1',
    toHeuristic: overrides.toHeuristic ?? 0.64,
    toVersion: overrides.toVersion ?? 4,
  }
}

function makeRejectedEvent(overrides: {
  commandType?: string
  fromVersion?: number
  projectId?: string
  reason?: string
} = {}) {
  return {
    accepted: false as const,
    commandType: overrides.commandType ?? 'curate',
    fromVersion: overrides.fromVersion ?? 3,
    projectId: overrides.projectId ?? 'proj-1',
    reason: overrides.reason ?? 'delta H was -0.10, below acceptance threshold',
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HarnessBannerListener', () => {
  afterEach(() => {
    sinon.restore()
  })

  // Test 1: Accepted refinement + TTY + enabled → banner prints
  it('prints banner when accepted refinement fires with TTY and enabled', () => {
    const eventBus = new AgentEventBus()
    const writeLine = sinon.stub()
    const listener = new HarnessBannerListener(eventBus, writeLine, true, true)

    eventBus.emit('harness:refinement-completed', makeAcceptedEvent())
    listener.onSessionEnd()

    expect(writeLine.callCount).to.equal(1)
    expect(writeLine.firstCall.args[0]).to.include('harness updated')
  })

  // Test 2: Accepted refinement + TTY + disabled → no print
  it('does not print when harness is disabled', () => {
    const eventBus = new AgentEventBus()
    const writeLine = sinon.stub()
    const listener = new HarnessBannerListener(eventBus, writeLine, true, false)

    eventBus.emit('harness:refinement-completed', makeAcceptedEvent())
    listener.onSessionEnd()

    expect(writeLine.callCount).to.equal(0)
  })

  // Test 3: Accepted refinement + not TTY → no print
  it('does not print when not a TTY', () => {
    const eventBus = new AgentEventBus()
    const writeLine = sinon.stub()
    const listener = new HarnessBannerListener(eventBus, writeLine, false, true)

    eventBus.emit('harness:refinement-completed', makeAcceptedEvent())
    listener.onSessionEnd()

    expect(writeLine.callCount).to.equal(0)
  })

  // Test 4: Rejected refinement → no print
  it('does not print for rejected refinements', () => {
    const eventBus = new AgentEventBus()
    const writeLine = sinon.stub()
    const listener = new HarnessBannerListener(eventBus, writeLine, true, true)

    eventBus.emit('harness:refinement-completed', makeRejectedEvent())
    listener.onSessionEnd()

    expect(writeLine.callCount).to.equal(0)
  })

  // Test 5: Multiple accepteds → only last one prints
  it('prints only the last accepted refinement when multiple fire', () => {
    const eventBus = new AgentEventBus()
    const writeLine = sinon.stub()
    const listener = new HarnessBannerListener(eventBus, writeLine, true, true)

    eventBus.emit('harness:refinement-completed', makeAcceptedEvent({
      fromHeuristic: 0.4,
      fromVersion: 1,
      toHeuristic: 0.5,
      toVersion: 2,
    }))
    eventBus.emit('harness:refinement-completed', makeAcceptedEvent({
      fromHeuristic: 0.5,
      fromVersion: 2,
      toHeuristic: 0.64,
      toVersion: 3,
    }))

    listener.onSessionEnd()

    expect(writeLine.callCount).to.equal(1)
    const output = writeLine.firstCall.args[0] as string
    expect(output).to.include('v2')
    expect(output).to.include('v3')
    expect(output).to.not.include('v1')
  })

  // Test 6: Zero refinements → no print
  it('does not print when no refinements occurred', () => {
    const eventBus = new AgentEventBus()
    const writeLine = sinon.stub()
    const listener = new HarnessBannerListener(eventBus, writeLine, true, true)

    listener.onSessionEnd()

    expect(writeLine.callCount).to.equal(0)
  })

  // Test 7: Banner format matches spec
  it('formats banner as v{from} → v{to} (H: {fromH} → {toH})', () => {
    const eventBus = new AgentEventBus()
    const writeLine = sinon.stub()
    const listener = new HarnessBannerListener(eventBus, writeLine, true, true)

    eventBus.emit('harness:refinement-completed', makeAcceptedEvent({
      fromHeuristic: 0.58,
      fromVersion: 3,
      toHeuristic: 0.64,
      toVersion: 4,
    }))

    listener.onSessionEnd()

    expect(writeLine.callCount).to.equal(1)
    const output = writeLine.firstCall.args[0] as string
    expect(output).to.equal('harness updated: v3 → v4 (H: 0.58 → 0.64)\n')
  })

  // Test 8: onSessionEnd is idempotent — second call does not re-print
  it('does not re-print on second onSessionEnd call', () => {
    const eventBus = new AgentEventBus()
    const writeLine = sinon.stub()
    const listener = new HarnessBannerListener(eventBus, writeLine, true, true)

    eventBus.emit('harness:refinement-completed', makeAcceptedEvent())
    listener.onSessionEnd()
    listener.onSessionEnd()

    expect(writeLine.callCount).to.equal(1)
  })

  // Test 9: Listener unsubscribes on session end — events after don't accumulate
  it('stops listening to events after onSessionEnd', () => {
    const eventBus = new AgentEventBus()
    const writeLine = sinon.stub()
    const listener = new HarnessBannerListener(eventBus, writeLine, true, true)

    listener.onSessionEnd()

    // Event after session end should not be captured
    eventBus.emit('harness:refinement-completed', makeAcceptedEvent())
    listener.onSessionEnd()

    expect(writeLine.callCount).to.equal(0)
  })
})
