import {expect} from 'chai'

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
  })
})
