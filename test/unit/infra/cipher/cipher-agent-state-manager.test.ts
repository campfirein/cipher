import {expect} from 'chai'

import {TerminationReason} from '../../../../src/core/domain/cipher/agent/agent-state.js'
import {CipherAgentStateManager} from '../../../../src/infra/cipher/cipher-agent-state-manager.js'

describe('CipherAgentStateManager', () => {
  let stateManager: CipherAgentStateManager

  beforeEach(() => {
    stateManager = new CipherAgentStateManager()
  })

  describe('constructor', () => {
    it('should initialize with zero iterations and empty history', () => {
      const state = stateManager.getState()

      expect(state.currentIteration).to.equal(0)
      expect(state.executionHistory).to.deep.equal([])
    })

    it('should initialize with idle execution state', () => {
      const state = stateManager.getState()
      expect(state.executionState).to.equal('idle')
    })

    it('should initialize with zero tool calls', () => {
      const state = stateManager.getState()
      expect(state.toolCallsExecuted).to.equal(0)
    })

    it('should initialize without timing fields', () => {
      const state = stateManager.getState()
      expect(state.startTime).to.be.undefined
      expect(state.endTime).to.be.undefined
      expect(state.durationMs).to.be.undefined
    })

    it('should initialize without termination reason', () => {
      const state = stateManager.getState()
      expect(state.terminationReason).to.be.undefined
    })
  })

  describe('incrementIteration', () => {
    it('should increment iteration counter from 0 to 1', () => {
      const iteration = stateManager.incrementIteration()

      expect(iteration).to.equal(1)
      expect(stateManager.getState().currentIteration).to.equal(1)
    })

    it('should increment iteration counter multiple times', () => {
      stateManager.incrementIteration()
      stateManager.incrementIteration()
      const iteration = stateManager.incrementIteration()

      expect(iteration).to.equal(3)
      expect(stateManager.getState().currentIteration).to.equal(3)
    })

    it('should return the new iteration count', () => {
      const first = stateManager.incrementIteration()
      const second = stateManager.incrementIteration()

      expect(first).to.equal(1)
      expect(second).to.equal(2)
    })
  })

  describe('addExecutionRecord', () => {
    it('should add a single record to history', () => {
      stateManager.addExecutionRecord('First execution')

      const state = stateManager.getState()
      expect(state.executionHistory).to.have.lengthOf(1)
      expect(state.executionHistory[0]).to.equal('First execution')
    })

    it('should add multiple records in order', () => {
      stateManager.addExecutionRecord('First')
      stateManager.addExecutionRecord('Second')
      stateManager.addExecutionRecord('Third')

      const state = stateManager.getState()
      expect(state.executionHistory).to.deep.equal(['First', 'Second', 'Third'])
    })

    it('should handle empty string records', () => {
      stateManager.addExecutionRecord('')

      const state = stateManager.getState()
      expect(state.executionHistory).to.have.lengthOf(1)
      expect(state.executionHistory[0]).to.equal('')
    })
  })

  describe('getState', () => {
    it('should return current state with iteration and history', () => {
      stateManager.incrementIteration()
      stateManager.addExecutionRecord('Test record')

      const state = stateManager.getState()

      expect(state.currentIteration).to.equal(1)
      expect(state.executionHistory).to.deep.equal(['Test record'])
    })

    it('should return a defensive copy of execution history', () => {
      stateManager.addExecutionRecord('Original')

      const state1 = stateManager.getState()
      state1.executionHistory.push('Modified')

      const state2 = stateManager.getState()
      expect(state2.executionHistory).to.deep.equal(['Original'])
      expect(state2.executionHistory).to.not.deep.equal(state1.executionHistory)
    })
  })

  describe('reset', () => {
    it('should reset iteration counter to zero', () => {
      stateManager.incrementIteration()
      stateManager.incrementIteration()

      stateManager.reset()

      expect(stateManager.getState().currentIteration).to.equal(0)
    })

    it('should clear execution history', () => {
      stateManager.addExecutionRecord('First')
      stateManager.addExecutionRecord('Second')

      stateManager.reset()

      expect(stateManager.getState().executionHistory).to.deep.equal([])
    })

    it('should reset both iteration and history', () => {
      stateManager.incrementIteration()
      stateManager.incrementIteration()
      stateManager.addExecutionRecord('Record 1')
      stateManager.addExecutionRecord('Record 2')

      stateManager.reset()

      const state = stateManager.getState()
      expect(state.currentIteration).to.equal(0)
      expect(state.executionHistory).to.deep.equal([])
    })

    it('should allow incrementing after reset', () => {
      stateManager.incrementIteration()
      stateManager.reset()

      const iteration = stateManager.incrementIteration()

      expect(iteration).to.equal(1)
      expect(stateManager.getState().currentIteration).to.equal(1)
    })
  })

  describe('incrementToolCalls', () => {
    it('should increment tool calls counter', () => {
      const count = stateManager.incrementToolCalls()
      expect(count).to.equal(1)
      expect(stateManager.getState().toolCallsExecuted).to.equal(1)
    })

    it('should increment tool calls multiple times', () => {
      stateManager.incrementToolCalls()
      stateManager.incrementToolCalls()
      const count = stateManager.incrementToolCalls()
      expect(count).to.equal(3)
    })
  })

  describe('setExecutionState', () => {
    it('should set execution state to executing', () => {
      stateManager.setExecutionState('executing')
      expect(stateManager.getState().executionState).to.equal('executing')
    })

    it('should set execution state to tool_calling', () => {
      stateManager.setExecutionState('tool_calling')
      expect(stateManager.getState().executionState).to.equal('tool_calling')
    })

    it('should set execution state to complete', () => {
      stateManager.setExecutionState('complete')
      expect(stateManager.getState().executionState).to.equal('complete')
    })
  })

  describe('startExecution', () => {
    it('should set startTime', () => {
      const before = new Date()
      stateManager.startExecution()
      const after = new Date()

      const state = stateManager.getState()
      expect(state.startTime).to.be.instanceOf(Date)
      expect(state.startTime!.getTime()).to.be.at.least(before.getTime())
      expect(state.startTime!.getTime()).to.be.at.most(after.getTime())
    })

    it('should set execution state to executing', () => {
      stateManager.startExecution()
      expect(stateManager.getState().executionState).to.equal('executing')
    })
  })

  describe('complete', () => {
    it('should set execution state to complete', () => {
      stateManager.startExecution()
      stateManager.complete(TerminationReason.GOAL)
      expect(stateManager.getState().executionState).to.equal('complete')
    })

    it('should set termination reason', () => {
      stateManager.startExecution()
      stateManager.complete(TerminationReason.GOAL)
      expect(stateManager.getState().terminationReason).to.equal(TerminationReason.GOAL)
    })

    it('should set endTime', () => {
      stateManager.startExecution()
      const before = new Date()
      stateManager.complete(TerminationReason.GOAL)
      const after = new Date()

      const state = stateManager.getState()
      expect(state.endTime).to.be.instanceOf(Date)
      expect(state.endTime!.getTime()).to.be.at.least(before.getTime())
      expect(state.endTime!.getTime()).to.be.at.most(after.getTime())
    })

    it('should calculate durationMs when startTime exists', () => {
      stateManager.startExecution()
      stateManager.complete(TerminationReason.GOAL)
      expect(stateManager.getState().durationMs).to.be.a('number')
      expect(stateManager.getState().durationMs).to.be.at.least(0)
    })

    it('should handle MAX_TURNS termination reason', () => {
      stateManager.startExecution()
      stateManager.complete(TerminationReason.MAX_TURNS)
      expect(stateManager.getState().terminationReason).to.equal(TerminationReason.MAX_TURNS)
    })
  })

  describe('fail', () => {
    it('should set execution state to error', () => {
      stateManager.startExecution()
      stateManager.fail(TerminationReason.ERROR)
      expect(stateManager.getState().executionState).to.equal('error')
    })

    it('should set termination reason', () => {
      stateManager.startExecution()
      stateManager.fail(TerminationReason.ERROR)
      expect(stateManager.getState().terminationReason).to.equal(TerminationReason.ERROR)
    })

    it('should set endTime', () => {
      stateManager.startExecution()
      stateManager.fail(TerminationReason.ERROR)
      expect(stateManager.getState().endTime).to.be.instanceOf(Date)
    })

    it('should calculate durationMs', () => {
      stateManager.startExecution()
      stateManager.fail(TerminationReason.ERROR)
      expect(stateManager.getState().durationMs).to.be.a('number')
    })
  })

  describe('reset - enhanced', () => {
    it('should reset all FSM-related fields', () => {
      stateManager.startExecution()
      stateManager.incrementToolCalls()
      stateManager.incrementToolCalls()
      stateManager.complete(TerminationReason.GOAL)

      stateManager.reset()

      const state = stateManager.getState()
      expect(state.executionState).to.equal('idle')
      expect(state.toolCallsExecuted).to.equal(0)
      expect(state.startTime).to.be.undefined
      expect(state.endTime).to.be.undefined
      expect(state.durationMs).to.be.undefined
      expect(state.terminationReason).to.be.undefined
    })
  })

  describe('integration - typical usage pattern', () => {
    it('should track multiple execution cycles correctly', () => {
      // First execution
      const iter1 = stateManager.incrementIteration()
      stateManager.addExecutionRecord(`Iteration ${iter1}: User query 1`)

      // Second execution
      const iter2 = stateManager.incrementIteration()
      stateManager.addExecutionRecord(`Iteration ${iter2}: User query 2`)

      // Check state
      const state = stateManager.getState()
      expect(state.currentIteration).to.equal(2)
      expect(state.executionHistory).to.have.lengthOf(2)
      expect(state.executionHistory[0]).to.include('Iteration 1')
      expect(state.executionHistory[1]).to.include('Iteration 2')
    })

    it('should handle reset and continue pattern', () => {
      // Initial executions
      stateManager.incrementIteration()
      stateManager.addExecutionRecord('Record 1')
      stateManager.incrementIteration()
      stateManager.addExecutionRecord('Record 2')

      // Reset (new conversation)
      stateManager.reset()

      // New executions
      const iter = stateManager.incrementIteration()
      stateManager.addExecutionRecord('New conversation')

      const state = stateManager.getState()
      expect(state.currentIteration).to.equal(1)
      expect(state.executionHistory).to.deep.equal(['New conversation'])
      expect(iter).to.equal(1)
    })

    it('should track full execution lifecycle with FSM', () => {
      // Start execution
      stateManager.startExecution()
      expect(stateManager.getState().executionState).to.equal('executing')

      // Simulate tool calls
      stateManager.setExecutionState('tool_calling')
      stateManager.incrementToolCalls()
      stateManager.incrementToolCalls()

      // Back to executing
      stateManager.setExecutionState('executing')
      stateManager.incrementIteration()

      // Complete
      stateManager.complete(TerminationReason.GOAL)

      const state = stateManager.getState()
      expect(state.executionState).to.equal('complete')
      expect(state.toolCallsExecuted).to.equal(2)
      expect(state.currentIteration).to.equal(1)
      expect(state.terminationReason).to.equal(TerminationReason.GOAL)
      expect(state.durationMs).to.be.a('number')
    })
  })
})
