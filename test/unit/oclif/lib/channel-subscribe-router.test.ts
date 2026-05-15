import {expect} from 'chai'

import type {TurnEvent} from '../../../../src/shared/types/channel.js'

import {ChannelSubscribeRouter} from '../../../../src/oclif/lib/channel-subscribe-router.js'

// Slice 8.9 — fake-client unit tests for the buffer/dedup/termination
// orchestrator extracted from `channel subscribe`. Codex impl-review R5
// (turnId RfdvMgmBjS8bSLGdKweXw on 2026-05-15) asked specifically for
// these scenarios: ordering across replay+live, dedup against double-emit,
// and monotonic lastSeen.

const baseEvent = (overrides: Partial<TurnEvent> & {kind: TurnEvent['kind']}): TurnEvent => {
  const base = {
    channelId: 'ch',
    deliveryId: 'del-1',
    emittedAt: '2026-05-15T00:00:00.000Z',
    memberHandle: '@codex',
    seq: 1,
    turnId: 'turn-1',
  }
  switch (overrides.kind) {
    case 'agent_message_chunk': {
      return {...base, ...overrides, content: 'hello'} as TurnEvent
    }

    case 'delivery_state_change': {
      return {...base, ...overrides, from: 'streaming', to: 'completed'} as TurnEvent
    }

    case 'turn_state_change': {
      return {...base, ...overrides, deliveryId: null, from: 'dispatched', memberHandle: null, to: 'completed'} as TurnEvent
    }

    default: {
      return {...base, ...overrides} as TurnEvent
    }
  }
}

type Recorder = {emitted: TurnEvent[]; terminationReason?: 'count' | 'terminal'}

const makeRouter = (opts: Partial<ConstructorParameters<typeof ChannelSubscribeRouter>[0]> = {}): {recorder: Recorder; router: ChannelSubscribeRouter} => {
  const recorder: Recorder = {emitted: []}
  const router = new ChannelSubscribeRouter({
    exitOnTerminal: false,
    filter: {},
    onEmit: (e) => recorder.emitted.push(e),
    onTerminate(reason) {
      recorder.terminationReason = reason
    },
    ...opts,
  })
  return {recorder, router}
}

describe('ChannelSubscribeRouter (Slice 8.9 codex impl-review R5)', () => {
  describe('replay buffering — codex impl-review high-2', () => {
    it('buffers live events during replay and drains them in arrival order after replay', () => {
      const {recorder, router} = makeRouter()
      router.beginReplay()
      // Live seq=7 arrives DURING replay — must NOT emit immediately.
      router.pushLive(baseEvent({kind: 'agent_message_chunk', seq: 7, turnId: 'turn-1'}))
      expect(recorder.emitted).to.have.length(0)
      // Replay walks history: seq=4, 5, 6.
      router.pushReplay(baseEvent({kind: 'agent_message_chunk', seq: 4, turnId: 'turn-1'}))
      router.pushReplay(baseEvent({kind: 'agent_message_chunk', seq: 5, turnId: 'turn-1'}))
      router.pushReplay(baseEvent({kind: 'agent_message_chunk', seq: 6, turnId: 'turn-1'}))
      // Replay completes — drain buffer.
      router.finishReplay()
      // Expected emission order: 4, 5, 6, 7 (NOT 7, 4, 5, 6).
      expect(recorder.emitted.map((e) => e.seq)).to.deep.equal([4, 5, 6, 7])
    })

    it('keeps lastSeen monotonic across replay then live drain', () => {
      const {recorder, router} = makeRouter()
      router.beginReplay()
      router.pushLive(baseEvent({kind: 'agent_message_chunk', seq: 7, turnId: 'turn-1'}))
      router.pushReplay(baseEvent({kind: 'agent_message_chunk', seq: 4, turnId: 'turn-1'}))
      expect(router.lastSeen()).to.deep.equal({seq: 4, turnId: 'turn-1'})
      router.pushReplay(baseEvent({kind: 'agent_message_chunk', seq: 5, turnId: 'turn-1'}))
      router.pushReplay(baseEvent({kind: 'agent_message_chunk', seq: 6, turnId: 'turn-1'}))
      expect(router.lastSeen()).to.deep.equal({seq: 6, turnId: 'turn-1'})
      router.finishReplay()
      // After drain, lastSeen reflects the buffered seq=7.
      expect(router.lastSeen()).to.deep.equal({seq: 7, turnId: 'turn-1'})
      expect(recorder.emitted.map((e) => e.seq)).to.deep.equal([4, 5, 6, 7])
    })

    it('subsequent live events after finishReplay emit directly (no longer buffered)', () => {
      const {recorder, router} = makeRouter()
      router.beginReplay()
      router.pushReplay(baseEvent({kind: 'agent_message_chunk', seq: 4, turnId: 'turn-1'}))
      router.finishReplay()
      // Now in live mode.
      router.pushLive(baseEvent({kind: 'agent_message_chunk', seq: 8, turnId: 'turn-1'}))
      router.pushLive(baseEvent({kind: 'agent_message_chunk', seq: 9, turnId: 'turn-1'}))
      expect(recorder.emitted.map((e) => e.seq)).to.deep.equal([4, 8, 9])
    })

    it('skips dedup when an event is seen via BOTH replay and live (codex impl-review high-2)', () => {
      const {recorder, router} = makeRouter()
      router.beginReplay()
      // Same (turnId, seq=5) arrives live first, then again via replay.
      router.pushLive(baseEvent({kind: 'agent_message_chunk', seq: 5, turnId: 'turn-1'}))
      router.pushReplay(baseEvent({kind: 'agent_message_chunk', seq: 5, turnId: 'turn-1'}))
      router.finishReplay()
      // Emitted exactly once.
      expect(recorder.emitted.map((e) => e.seq)).to.deep.equal([5])
    })
  })

  describe('forward-only mode (no replay)', () => {
    it('emits live events directly when beginReplay was not called', () => {
      const {recorder, router} = makeRouter()
      router.pushLive(baseEvent({kind: 'agent_message_chunk', seq: 1, turnId: 'turn-1'}))
      router.pushLive(baseEvent({kind: 'agent_message_chunk', seq: 2, turnId: 'turn-1'}))
      expect(recorder.emitted.map((e) => e.seq)).to.deep.equal([1, 2])
    })

    it('finishReplay is idempotent when no replay was started', () => {
      const {recorder, router} = makeRouter()
      router.finishReplay()
      router.pushLive(baseEvent({kind: 'agent_message_chunk', seq: 1, turnId: 'turn-1'}))
      expect(recorder.emitted.map((e) => e.seq)).to.deep.equal([1])
    })
  })

  describe('filter precedence', () => {
    it('applies roles filter to member-scoped events', () => {
      const {recorder, router} = makeRouter({filter: {roles: new Set(['@codex'])}})
      router.pushLive(baseEvent({kind: 'agent_message_chunk', memberHandle: '@codex'}))
      router.pushLive(baseEvent({kind: 'agent_message_chunk', memberHandle: '@kimi'}))
      expect(recorder.emitted.map((e) => e.memberHandle)).to.deep.equal(['@codex'])
    })

    it('passes turn-level events through roles filter (codex P2)', () => {
      const {recorder, router} = makeRouter({filter: {roles: new Set(['@codex'])}})
      router.pushLive(baseEvent({kind: 'turn_state_change'}))
      expect(recorder.emitted).to.have.length(1)
      expect(recorder.emitted[0].memberHandle).to.equal(null)
    })

    it('applies turn filter to scope replay/live by turnId', () => {
      const {recorder, router} = makeRouter({filter: {turn: 'turn-a'}})
      router.pushLive(baseEvent({kind: 'agent_message_chunk', seq: 1, turnId: 'turn-a'}))
      router.pushLive(baseEvent({kind: 'agent_message_chunk', seq: 1, turnId: 'turn-b'}))
      expect(recorder.emitted.map((e) => e.turnId)).to.deep.equal(['turn-a'])
    })
  })

  describe('termination — --exit-on-terminal', () => {
    it('terminates on any turn_state_change → completed', () => {
      const {recorder, router} = makeRouter({exitOnTerminal: true})
      router.pushLive(baseEvent({kind: 'agent_message_chunk', seq: 1}))
      router.pushLive(baseEvent({kind: 'turn_state_change', seq: 2}))
      expect(recorder.terminationReason).to.equal('terminal')
      expect(router.isTerminated()).to.equal(true)
    })

    it('drops events received after termination', () => {
      const {recorder, router} = makeRouter({exitOnTerminal: true})
      router.pushLive(baseEvent({kind: 'turn_state_change', seq: 1}))
      router.pushLive(baseEvent({kind: 'agent_message_chunk', seq: 2}))
      expect(recorder.emitted).to.have.length(1)
      expect(recorder.emitted[0].kind).to.equal('turn_state_change')
    })

    // Codex impl-review-2 medium (turnId yI8_z-DYWyUagBAHxDMU0): terminal
    // exit must fire even when --kinds filters out turn_state_change.
    // Otherwise `--kinds agent_message_chunk --exit-on-terminal` would
    // stream chunks but never exit.
    it('fires on terminal turn_state_change even when --kinds filters it out', () => {
      const {recorder, router} = makeRouter({
        exitOnTerminal: true,
        filter: {kinds: new Set(['agent_message_chunk'])},
      })
      router.pushLive(baseEvent({kind: 'agent_message_chunk', seq: 1}))
      // turn_state_change does NOT match --kinds, so it would not be emitted —
      // but --exit-on-terminal must still trigger.
      router.pushLive(baseEvent({kind: 'turn_state_change', seq: 2}))
      expect(recorder.terminationReason).to.equal('terminal')
      // The terminal event itself was filtered out of stdout (only the chunk emitted).
      expect(recorder.emitted.map((e) => e.kind)).to.deep.equal(['agent_message_chunk'])
    })

    it('still respects --turn when --exit-on-terminal is set (unrelated turn does not fire)', () => {
      const {recorder, router} = makeRouter({
        exitOnTerminal: true,
        filter: {turn: 'turn-a'},
      })
      // Terminal event on turn-b — should NOT terminate.
      router.pushLive(baseEvent({kind: 'turn_state_change', seq: 1, turnId: 'turn-b'}))
      expect(recorder.terminationReason).to.equal(undefined)
      // Terminal event on turn-a — fires.
      router.pushLive(baseEvent({kind: 'turn_state_change', seq: 1, turnId: 'turn-a'}))
      expect(recorder.terminationReason).to.equal('terminal')
    })
  })

  describe('termination — --count N quorum', () => {
    it('terminates after N unique (turnId, memberHandle) terminal delivery events (codex P3)', () => {
      const {recorder, router} = makeRouter({count: 2})
      router.pushLive(baseEvent({deliveryId: 'd1', kind: 'delivery_state_change', memberHandle: '@codex', seq: 1}))
      expect(recorder.terminationReason).to.equal(undefined)
      router.pushLive(baseEvent({deliveryId: 'd2', kind: 'delivery_state_change', memberHandle: '@kimi', seq: 2}))
      expect(recorder.terminationReason).to.equal('count')
    })

    it('counts two deliveries by same member in same turn as ONE quorum unit', () => {
      const {recorder, router} = makeRouter({count: 2})
      router.pushLive(baseEvent({deliveryId: 'd1', kind: 'delivery_state_change', memberHandle: '@codex', seq: 1, turnId: 'turn-1'}))
      router.pushLive(baseEvent({deliveryId: 'd2', kind: 'delivery_state_change', memberHandle: '@codex', seq: 2, turnId: 'turn-1'}))
      // Same (turnId, member) — still only 1 unit, no termination.
      expect(recorder.terminationReason).to.equal(undefined)
      router.pushLive(baseEvent({deliveryId: 'd3', kind: 'delivery_state_change', memberHandle: '@kimi', seq: 3, turnId: 'turn-1'}))
      expect(recorder.terminationReason).to.equal('count')
    })

    it('restricts quorum to --roles when set', () => {
      const {recorder, router} = makeRouter({count: 1, filter: {roles: new Set(['@codex'])}})
      // Live @kimi delivery — drops at filter, not counted toward quorum.
      router.pushLive(baseEvent({kind: 'delivery_state_change', memberHandle: '@kimi', seq: 1}))
      expect(recorder.terminationReason).to.equal(undefined)
      expect(recorder.emitted).to.have.length(0)
      router.pushLive(baseEvent({kind: 'delivery_state_change', memberHandle: '@codex', seq: 2}))
      expect(recorder.terminationReason).to.equal('count')
    })
  })
})
