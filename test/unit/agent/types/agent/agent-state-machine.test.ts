import {expect} from 'chai'

import {AgentStateMachine} from '../../../../../src/agent/types/agent/agent-state-machine.js'
import {AgentState, TerminationReason} from '../../../../../src/agent/types/agent/agent-state.js'

// Helper function for testing invalid transitions
function expectTransitionToThrow(stateMachine: AgentStateMachine, targetState: AgentState, expectedMessage: string): void {
  expect(() => stateMachine.transition(targetState)).to.throw(expectedMessage)
}

describe('AgentStateMachine', () => {
  let stateMachine: AgentStateMachine

  beforeEach(() => {
    // Default: 10 iterations max, 10 minute timeout
    stateMachine = new AgentStateMachine(10, 600_000)
  })

  describe('constructor', () => {
    it('should initialize in IDLE state', () => {
      expect(stateMachine.getState()).to.equal(AgentState.IDLE)
    })

    it('should initialize with turnCount of 0', () => {
      const context = stateMachine.getContext()
      expect(context.turnCount).to.equal(0)
    })

    it('should initialize with toolCallsExecuted of 0', () => {
      const context = stateMachine.getContext()
      expect(context.toolCallsExecuted).to.equal(0)
    })

    it('should set startTime to current time', () => {
      const before = new Date()
      const sm = new AgentStateMachine(10, 600_000)
      const after = new Date()

      const context = sm.getContext()
      expect(context.startTime.getTime()).to.be.at.least(before.getTime())
      expect(context.startTime.getTime()).to.be.at.most(after.getTime())
    })

    it('should not have terminationReason initially', () => {
      const context = stateMachine.getContext()
      expect(context.terminationReason).to.be.undefined
    })

    it('should not have lastError initially', () => {
      const context = stateMachine.getContext()
      expect(context.lastError).to.be.undefined
    })
  })

  describe('transition', () => {
    describe('valid transitions from IDLE', () => {
      it('should transition from IDLE to EXECUTING', () => {
        stateMachine.transition(AgentState.EXECUTING)
        expect(stateMachine.getState()).to.equal(AgentState.EXECUTING)
      })
    })

    describe('valid transitions from EXECUTING', () => {
      beforeEach(() => {
        stateMachine.transition(AgentState.EXECUTING)
      })

      it('should transition from EXECUTING to TOOL_CALLING', () => {
        stateMachine.transition(AgentState.TOOL_CALLING)
        expect(stateMachine.getState()).to.equal(AgentState.TOOL_CALLING)
      })

      it('should transition from EXECUTING to COMPLETE', () => {
        stateMachine.transition(AgentState.COMPLETE)
        expect(stateMachine.getState()).to.equal(AgentState.COMPLETE)
      })

      it('should transition from EXECUTING to ERROR', () => {
        stateMachine.transition(AgentState.ERROR)
        expect(stateMachine.getState()).to.equal(AgentState.ERROR)
      })

      it('should transition from EXECUTING to ABORTED', () => {
        stateMachine.transition(AgentState.ABORTED)
        expect(stateMachine.getState()).to.equal(AgentState.ABORTED)
      })
    })

    describe('valid transitions from TOOL_CALLING', () => {
      beforeEach(() => {
        stateMachine.transition(AgentState.EXECUTING)
        stateMachine.transition(AgentState.TOOL_CALLING)
      })

      it('should transition from TOOL_CALLING to EXECUTING', () => {
        stateMachine.transition(AgentState.EXECUTING)
        expect(stateMachine.getState()).to.equal(AgentState.EXECUTING)
      })

      it('should transition from TOOL_CALLING to ERROR', () => {
        stateMachine.transition(AgentState.ERROR)
        expect(stateMachine.getState()).to.equal(AgentState.ERROR)
      })

      it('should transition from TOOL_CALLING to ABORTED', () => {
        stateMachine.transition(AgentState.ABORTED)
        expect(stateMachine.getState()).to.equal(AgentState.ABORTED)
      })
    })

    describe('invalid transitions', () => {
      it('should throw on transition from IDLE to TOOL_CALLING', () => {
        expectTransitionToThrow(stateMachine, AgentState.TOOL_CALLING, 'Invalid state transition: IDLE → TOOL_CALLING')
      })

      it('should throw on transition from IDLE to COMPLETE', () => {
        expectTransitionToThrow(stateMachine, AgentState.COMPLETE, 'Invalid state transition: IDLE → COMPLETE')
      })

      it('should throw on transition from COMPLETE to any state', () => {
        stateMachine.transition(AgentState.EXECUTING)
        stateMachine.transition(AgentState.COMPLETE)

        expectTransitionToThrow(stateMachine, AgentState.IDLE, 'Invalid state transition: COMPLETE → IDLE')
        expectTransitionToThrow(stateMachine, AgentState.EXECUTING, 'Invalid state transition: COMPLETE → EXECUTING')
      })

      it('should throw on transition from ERROR to any state', () => {
        stateMachine.transition(AgentState.EXECUTING)
        stateMachine.transition(AgentState.ERROR)

        expectTransitionToThrow(stateMachine, AgentState.IDLE, 'Invalid state transition: ERROR → IDLE')
      })

      it('should throw on transition from ABORTED to any state', () => {
        stateMachine.transition(AgentState.EXECUTING)
        stateMachine.transition(AgentState.ABORTED)

        expectTransitionToThrow(stateMachine, AgentState.IDLE, 'Invalid state transition: ABORTED → IDLE')
      })
    })
  })

  describe('isTerminal', () => {
    it('should return false for IDLE', () => {
      expect(stateMachine.isTerminal()).to.be.false
    })

    it('should return false for EXECUTING', () => {
      stateMachine.transition(AgentState.EXECUTING)
      expect(stateMachine.isTerminal()).to.be.false
    })

    it('should return false for TOOL_CALLING', () => {
      stateMachine.transition(AgentState.EXECUTING)
      stateMachine.transition(AgentState.TOOL_CALLING)
      expect(stateMachine.isTerminal()).to.be.false
    })

    it('should return true for COMPLETE', () => {
      stateMachine.transition(AgentState.EXECUTING)
      stateMachine.transition(AgentState.COMPLETE)
      expect(stateMachine.isTerminal()).to.be.true
    })

    it('should return true for ERROR', () => {
      stateMachine.transition(AgentState.EXECUTING)
      stateMachine.transition(AgentState.ERROR)
      expect(stateMachine.isTerminal()).to.be.true
    })

    it('should return true for ABORTED', () => {
      stateMachine.transition(AgentState.EXECUTING)
      stateMachine.transition(AgentState.ABORTED)
      expect(stateMachine.isTerminal()).to.be.true
    })
  })

  describe('incrementTurn', () => {
    it('should increment turnCount', () => {
      stateMachine.incrementTurn()
      expect(stateMachine.getContext().turnCount).to.equal(1)
    })

    it('should increment turnCount multiple times', () => {
      stateMachine.incrementTurn()
      stateMachine.incrementTurn()
      stateMachine.incrementTurn()
      expect(stateMachine.getContext().turnCount).to.equal(3)
    })
  })

  describe('recordToolCall', () => {
    it('should increment toolCallsExecuted', () => {
      stateMachine.recordToolCall()
      expect(stateMachine.getContext().toolCallsExecuted).to.equal(1)
    })

    it('should increment toolCallsExecuted multiple times', () => {
      stateMachine.recordToolCall()
      stateMachine.recordToolCall()
      stateMachine.recordToolCall()
      expect(stateMachine.getContext().toolCallsExecuted).to.equal(3)
    })
  })

  describe('shouldTerminate', () => {
    it('should return null when within limits', () => {
      stateMachine.transition(AgentState.EXECUTING)
      expect(stateMachine.shouldTerminate()).to.be.null
    })

    it('should return MAX_TURNS when turn limit exceeded', () => {
      const sm = new AgentStateMachine(3, 600_000)
      sm.transition(AgentState.EXECUTING)

      // Exceed max turns
      sm.incrementTurn()
      sm.incrementTurn()
      sm.incrementTurn()

      expect(sm.shouldTerminate()).to.equal(TerminationReason.MAX_TURNS)
    })

    it('should return TIMEOUT when time limit exceeded', () => {
      // Create with very short timeout (1ms)
      const sm = new AgentStateMachine(100, 1)
      sm.transition(AgentState.EXECUTING)

      // Wait a bit to exceed timeout
      const start = Date.now()
      while (Date.now() - start < 5) {
        // Busy wait for 5ms
      }

      expect(sm.shouldTerminate()).to.equal(TerminationReason.TIMEOUT)
    })

    it('should return null with very long timeout', () => {
      const sm = new AgentStateMachine(10, Number.MAX_SAFE_INTEGER) // Very long timeout
      sm.transition(AgentState.EXECUTING)

      expect(sm.shouldTerminate()).to.be.null
    })

    it('should check MAX_TURNS before TIMEOUT', () => {
      // Both limits exceeded - MAX_TURNS checked first
      const sm = new AgentStateMachine(1, 1)
      sm.transition(AgentState.EXECUTING)
      sm.incrementTurn()

      // Wait to exceed timeout
      const start = Date.now()
      while (Date.now() - start < 5) {
        // Busy wait
      }

      expect(sm.shouldTerminate()).to.equal(TerminationReason.MAX_TURNS)
    })
  })

  describe('complete', () => {
    it('should transition to COMPLETE state', () => {
      stateMachine.transition(AgentState.EXECUTING)
      stateMachine.complete()
      expect(stateMachine.getState()).to.equal(AgentState.COMPLETE)
    })

    it('should set terminationReason to GOAL', () => {
      stateMachine.transition(AgentState.EXECUTING)
      stateMachine.complete()
      expect(stateMachine.getContext().terminationReason).to.equal(TerminationReason.GOAL)
    })
  })

  describe('fail', () => {
    it('should transition to ERROR state', () => {
      stateMachine.transition(AgentState.EXECUTING)
      const error = new Error('Test error')
      stateMachine.fail(error)
      expect(stateMachine.getState()).to.equal(AgentState.ERROR)
    })

    it('should set terminationReason to ERROR', () => {
      stateMachine.transition(AgentState.EXECUTING)
      const error = new Error('Test error')
      stateMachine.fail(error)
      expect(stateMachine.getContext().terminationReason).to.equal(TerminationReason.ERROR)
    })

    it('should store the error in lastError', () => {
      stateMachine.transition(AgentState.EXECUTING)
      const error = new Error('Test error')
      stateMachine.fail(error)
      expect(stateMachine.getContext().lastError).to.equal(error)
    })
  })

  describe('abort', () => {
    it('should transition to ABORTED state', () => {
      stateMachine.transition(AgentState.EXECUTING)
      stateMachine.abort()
      expect(stateMachine.getState()).to.equal(AgentState.ABORTED)
    })

    it('should set terminationReason to ABORTED', () => {
      stateMachine.transition(AgentState.EXECUTING)
      stateMachine.abort()
      expect(stateMachine.getContext().terminationReason).to.equal(TerminationReason.ABORTED)
    })
  })

  describe('getContext', () => {
    it('should return readonly context', () => {
      const context = stateMachine.getContext()

      // TypeScript should prevent modification, but we test runtime
      expect(() => {
        // @ts-expect-error - Testing readonly protection
        context.turnCount = 999
      }).to.not.throw() // JavaScript allows it, TypeScript just warns

      // But internal state should be unchanged
      expect(stateMachine.getContext().turnCount).to.equal(0)
    })

    it('should return all context fields', () => {
      stateMachine.transition(AgentState.EXECUTING)
      stateMachine.incrementTurn()
      stateMachine.recordToolCall()
      stateMachine.complete()

      const context = stateMachine.getContext()

      expect(context.state).to.equal(AgentState.COMPLETE)
      expect(context.turnCount).to.equal(1)
      expect(context.toolCallsExecuted).to.equal(1)
      expect(context.terminationReason).to.equal(TerminationReason.GOAL)
      expect(context.startTime).to.be.instanceOf(Date)
    })
  })

  describe('integration - typical execution flow', () => {
    it('should handle successful execution flow', () => {
      // Start execution
      stateMachine.transition(AgentState.EXECUTING)
      expect(stateMachine.getState()).to.equal(AgentState.EXECUTING)

      // First turn - LLM makes tool call
      stateMachine.transition(AgentState.TOOL_CALLING)
      stateMachine.recordToolCall()
      expect(stateMachine.getContext().toolCallsExecuted).to.equal(1)

      // Return to executing after tool
      stateMachine.transition(AgentState.EXECUTING)
      stateMachine.incrementTurn()

      // Second turn - LLM makes more tool calls
      stateMachine.transition(AgentState.TOOL_CALLING)
      stateMachine.recordToolCall()
      stateMachine.recordToolCall()
      expect(stateMachine.getContext().toolCallsExecuted).to.equal(3)

      // Return to executing
      stateMachine.transition(AgentState.EXECUTING)
      stateMachine.incrementTurn()

      // Third turn - LLM completes without tool calls
      stateMachine.complete()

      expect(stateMachine.getState()).to.equal(AgentState.COMPLETE)
      expect(stateMachine.getContext().turnCount).to.equal(2)
      expect(stateMachine.getContext().toolCallsExecuted).to.equal(3)
      expect(stateMachine.getContext().terminationReason).to.equal(TerminationReason.GOAL)
      expect(stateMachine.isTerminal()).to.be.true
    })

    it('should handle error during execution', () => {
      stateMachine.transition(AgentState.EXECUTING)
      stateMachine.transition(AgentState.TOOL_CALLING)
      stateMachine.recordToolCall()

      const error = new Error('Tool execution failed')
      stateMachine.fail(error)

      expect(stateMachine.getState()).to.equal(AgentState.ERROR)
      expect(stateMachine.getContext().terminationReason).to.equal(TerminationReason.ERROR)
      expect(stateMachine.getContext().lastError).to.equal(error)
      expect(stateMachine.isTerminal()).to.be.true
    })

    it('should handle abort during execution', () => {
      stateMachine.transition(AgentState.EXECUTING)
      stateMachine.incrementTurn()
      stateMachine.transition(AgentState.TOOL_CALLING)
      stateMachine.recordToolCall()

      stateMachine.abort()

      expect(stateMachine.getState()).to.equal(AgentState.ABORTED)
      expect(stateMachine.getContext().terminationReason).to.equal(TerminationReason.ABORTED)
      expect(stateMachine.isTerminal()).to.be.true
    })

    it('should handle max turns termination', () => {
      const sm = new AgentStateMachine(2, 600_000)
      sm.transition(AgentState.EXECUTING)

      // Turn 1
      sm.incrementTurn()
      expect(sm.shouldTerminate()).to.be.null

      // Turn 2 - reaches limit
      sm.incrementTurn()
      expect(sm.shouldTerminate()).to.equal(TerminationReason.MAX_TURNS)
    })
  })
})
