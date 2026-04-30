import {expect} from 'chai'

import type {Turn, TurnState, TurnTransitionEvent} from '../../../../../src/server/core/domain/channel/types.js'

import {InvalidTransitionError} from '../../../../../src/server/core/domain/channel/errors.js'
import {isTerminalState, transition} from '../../../../../src/server/core/domain/channel/state-machine.js'
import {turnFixture} from '../../../../helpers/channel-fixtures.js'

function makeTurn(state: TurnState): Turn {
  // Non-terminal states should have endedAt absent — strip it without destructuring to keep the type clean.
  const turn: Turn = {...turnFixture, state}
  Reflect.deleteProperty(turn, 'endedAt')
  return turn
}

describe('channel state machine', () => {
  describe('legal transitions', () => {
    it('walks the happy path submitted → routing → in_flight → completed', () => {
      let turn = makeTurn('submitted')
      turn = transition(turn, {type: 'route'})
      expect(turn.state).to.equal('routing')

      turn = transition(turn, {type: 'start'})
      expect(turn.state).to.equal('in_flight')

      turn = transition(turn, {type: 'complete'})
      expect(turn.state).to.equal('completed')
      expect(turn.endedAt).to.be.a('string')
    })

    it('routes through awaiting_permission and resumes on allow', () => {
      let turn = makeTurn('in_flight')
      turn = transition(turn, {permissionRequestId: 'p-1', type: 'await_permission'})
      expect(turn.state).to.equal('awaiting_permission')

      turn = transition(turn, {decision: 'allow', type: 'permission_decision'})
      expect(turn.state).to.equal('in_flight')
      expect(turn.endedAt).to.equal(undefined)

      turn = transition(turn, {type: 'complete'})
      expect(turn.state).to.equal('completed')
    })

    it('routes permission_decision=deny to failed', () => {
      let turn = makeTurn('awaiting_permission')
      turn = transition(turn, {decision: 'deny', type: 'permission_decision'})
      expect(turn.state).to.equal('failed')
      expect(turn.endedAt).to.be.a('string')
    })

    it('routes expire from awaiting_permission to expired', () => {
      let turn = makeTurn('awaiting_permission')
      turn = transition(turn, {type: 'expire'})
      expect(turn.state).to.equal('expired')
      expect(turn.endedAt).to.be.a('string')
    })

    it('cancels from any non-terminal state', () => {
      const states: TurnState[] = ['submitted', 'routing', 'in_flight', 'awaiting_permission']
      for (const state of states) {
        const turn = transition(makeTurn(state), {type: 'cancel'})
        expect(turn.state, `cancel from ${state}`).to.equal('cancelled')
        expect(turn.endedAt, `endedAt set on cancel from ${state}`).to.be.a('string')
      }
    })

    it('fails from any non-terminal state', () => {
      const states: TurnState[] = ['submitted', 'routing', 'in_flight', 'awaiting_permission']
      for (const state of states) {
        const turn = transition(makeTurn(state), {reason: 'driver_crash', type: 'fail'})
        expect(turn.state, `fail from ${state}`).to.equal('failed')
        expect(turn.endedAt, `endedAt set on fail from ${state}`).to.be.a('string')
      }
    })

    it('preserves all non-state fields across transitions', () => {
      const turn = makeTurn('submitted')
      const next = transition(turn, {type: 'route'})
      expect(next.turnId).to.equal(turn.turnId)
      expect(next.channelId).to.equal(turn.channelId)
      expect(next.agentId).to.equal(turn.agentId)
      expect(next.promptText).to.equal(turn.promptText)
      expect(next.startedAt).to.equal(turn.startedAt)
    })

    it('uses the injected clock for endedAt on terminal transitions', () => {
      const fixed = '2099-12-31T23:59:59.000Z'
      const turn = transition(makeTurn('in_flight'), {type: 'complete'}, () => fixed)
      expect(turn.endedAt).to.equal(fixed)
    })
  })

  describe('illegal transitions', () => {
    it('throws when routing from a non-submitted state', () => {
      expect(() => transition(makeTurn('in_flight'), {type: 'route'}))
        .to.throw(InvalidTransitionError)
    })

    it('throws when starting from a non-routing state', () => {
      expect(() => transition(makeTurn('submitted'), {type: 'start'}))
        .to.throw(InvalidTransitionError)
    })

    it('throws when completing from a non-in_flight state', () => {
      expect(() => transition(makeTurn('routing'), {type: 'complete'}))
        .to.throw(InvalidTransitionError)
    })

    it('throws when awaiting permission from a non-in_flight state', () => {
      expect(() => transition(makeTurn('routing'), {permissionRequestId: 'p-1', type: 'await_permission'}))
        .to.throw(InvalidTransitionError)
    })

    it('throws when applying a permission decision outside awaiting_permission', () => {
      expect(() => transition(makeTurn('in_flight'), {decision: 'allow', type: 'permission_decision'}))
        .to.throw(InvalidTransitionError)
    })

    it('throws when expiring from a non-awaiting_permission state', () => {
      expect(() => transition(makeTurn('in_flight'), {type: 'expire'}))
        .to.throw(InvalidTransitionError)
    })
  })

  describe('terminal states', () => {
    const terminals: TurnState[] = ['cancelled', 'completed', 'expired', 'failed']

    it('rejects every event from every terminal state', () => {
      const events: TurnTransitionEvent[] = [
        {type: 'cancel'},
        {type: 'complete'},
        {type: 'expire'},
        {reason: 'x', type: 'fail'},
        {permissionRequestId: 'p', type: 'await_permission'},
        {decision: 'allow', type: 'permission_decision'},
        {type: 'route'},
        {type: 'start'},
      ]

      for (const state of terminals) {
        for (const event of events) {
          expect(
            () => transition(makeTurn(state), event),
            `event ${event.type} from terminal ${state}`,
          ).to.throw(InvalidTransitionError)
        }
      }
    })

    it('reports terminal-state membership via isTerminalState()', () => {
      for (const state of terminals) {
        expect(isTerminalState(state), state).to.equal(true)
      }

      const nonTerminals: TurnState[] = ['submitted', 'routing', 'in_flight', 'awaiting_permission']
      for (const state of nonTerminals) {
        expect(isTerminalState(state), state).to.equal(false)
      }
    })
  })
})
