import {expect} from 'chai'
import {createSandbox, type SinonSandbox} from 'sinon'

import type {ValidatedAgentConfig} from '../../../src/agent/infra/agent/agent-schemas.js'

import {TerminationReason} from '../../../src/agent/core/domain/agent/agent-state.js'
import {AgentStateManager} from '../../../src/agent/infra/agent/agent-state-manager.js'
import {AgentEventBus} from '../../../src/agent/infra/events/event-emitter.js'

/**
 * Creates a minimal valid config for testing.
 */
function createTestConfig(overrides?: Partial<ValidatedAgentConfig>): ValidatedAgentConfig {
  return {
    accessToken: 'test-token',
    apiBaseUrl: 'https://api.test.com',
    llm: {
      maxIterations: 50,
      maxTokens: 8192,
      temperature: 0.7,
      verbose: false,
    },
    model: 'test-model',
    projectId: 'test-project',
    sessionKey: 'test-session-key',
    sessions: {
      maxSessions: 100,
      sessionTTL: 3_600_000,
    },
    useGranularStorage: false,
    ...overrides,
  }
}

describe('AgentStateManager', () => {
  let stateManager: AgentStateManager
  let eventBus: AgentEventBus
  let sandbox: SinonSandbox

  beforeEach(() => {
    sandbox = createSandbox()
    eventBus = new AgentEventBus()
    stateManager = new AgentStateManager(createTestConfig(), eventBus)
  })

  afterEach(() => {
    sandbox.restore()
  })

  describe('constructor', () => {
    it('should initialize with zero iterations and empty history', () => {
      const state = stateManager.getExecutionState()

      expect(state.currentIteration).to.equal(0)
      expect(state.executionHistory).to.deep.equal([])
    })

    it('should initialize with idle execution state', () => {
      const state = stateManager.getExecutionState()
      expect(state.executionState).to.equal('idle')
    })

    it('should initialize with zero tool calls', () => {
      const state = stateManager.getExecutionState()
      expect(state.toolCallsExecuted).to.equal(0)
    })

    it('should initialize without timing fields', () => {
      const state = stateManager.getExecutionState()
      expect(state.startTime).to.be.undefined
      expect(state.endTime).to.be.undefined
      expect(state.durationMs).to.be.undefined
    })

    it('should initialize without termination reason', () => {
      const state = stateManager.getExecutionState()
      expect(state.terminationReason).to.be.undefined
    })

    it('should store baseline config immutably', () => {
      const config = createTestConfig()
      const manager = new AgentStateManager(config, eventBus)

      const baseline = manager.getBaselineConfig()
      expect(baseline.model).to.equal('test-model')
      expect(baseline).to.not.equal(config) // Should be a clone
    })
  })

  describe('incrementIteration', () => {
    it('should increment iteration counter from 0 to 1', () => {
      const iteration = stateManager.incrementIteration()

      expect(iteration).to.equal(1)
      expect(stateManager.getExecutionState().currentIteration).to.equal(1)
    })

    it('should increment iteration counter multiple times', () => {
      stateManager.incrementIteration()
      stateManager.incrementIteration()
      const iteration = stateManager.incrementIteration()

      expect(iteration).to.equal(3)
      expect(stateManager.getExecutionState().currentIteration).to.equal(3)
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

      const state = stateManager.getExecutionState()
      expect(state.executionHistory).to.have.lengthOf(1)
      expect(state.executionHistory[0]).to.equal('First execution')
    })

    it('should add multiple records in order', () => {
      stateManager.addExecutionRecord('First')
      stateManager.addExecutionRecord('Second')
      stateManager.addExecutionRecord('Third')

      const state = stateManager.getExecutionState()
      expect(state.executionHistory).to.deep.equal(['First', 'Second', 'Third'])
    })

    it('should handle empty string records', () => {
      stateManager.addExecutionRecord('')

      const state = stateManager.getExecutionState()
      expect(state.executionHistory).to.have.lengthOf(1)
      expect(state.executionHistory[0]).to.equal('')
    })
  })

  describe('getExecutionState', () => {
    it('should return current state with iteration and history', () => {
      stateManager.incrementIteration()
      stateManager.addExecutionRecord('Test record')

      const state = stateManager.getExecutionState()

      expect(state.currentIteration).to.equal(1)
      expect(state.executionHistory).to.deep.equal(['Test record'])
    })

    it('should return a defensive copy of execution history', () => {
      stateManager.addExecutionRecord('Original')

      const state1 = stateManager.getExecutionState()
      state1.executionHistory.push('Modified')

      const state2 = stateManager.getExecutionState()
      expect(state2.executionHistory).to.deep.equal(['Original'])
      expect(state2.executionHistory).to.not.deep.equal(state1.executionHistory)
    })
  })

  describe('reset', () => {
    it('should reset iteration counter to zero', () => {
      stateManager.incrementIteration()
      stateManager.incrementIteration()

      stateManager.reset()

      expect(stateManager.getExecutionState().currentIteration).to.equal(0)
    })

    it('should clear execution history', () => {
      stateManager.addExecutionRecord('First')
      stateManager.addExecutionRecord('Second')

      stateManager.reset()

      expect(stateManager.getExecutionState().executionHistory).to.deep.equal([])
    })

    it('should reset both iteration and history', () => {
      stateManager.incrementIteration()
      stateManager.incrementIteration()
      stateManager.addExecutionRecord('Record 1')
      stateManager.addExecutionRecord('Record 2')

      stateManager.reset()

      const state = stateManager.getExecutionState()
      expect(state.currentIteration).to.equal(0)
      expect(state.executionHistory).to.deep.equal([])
    })

    it('should allow incrementing after reset', () => {
      stateManager.incrementIteration()
      stateManager.reset()

      const iteration = stateManager.incrementIteration()

      expect(iteration).to.equal(1)
      expect(stateManager.getExecutionState().currentIteration).to.equal(1)
    })
  })

  describe('incrementToolCalls', () => {
    it('should increment tool calls counter', () => {
      const count = stateManager.incrementToolCalls()
      expect(count).to.equal(1)
      expect(stateManager.getExecutionState().toolCallsExecuted).to.equal(1)
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
      expect(stateManager.getExecutionState().executionState).to.equal('executing')
    })

    it('should set execution state to tool_calling', () => {
      stateManager.setExecutionState('tool_calling')
      expect(stateManager.getExecutionState().executionState).to.equal('tool_calling')
    })

    it('should set execution state to complete', () => {
      stateManager.setExecutionState('complete')
      expect(stateManager.getExecutionState().executionState).to.equal('complete')
    })
  })

  describe('startExecution', () => {
    it('should set startTime', () => {
      const before = new Date()
      stateManager.startExecution()
      const after = new Date()

      const state = stateManager.getExecutionState()
      expect(state.startTime).to.be.instanceOf(Date)
      expect(state.startTime!.getTime()).to.be.at.least(before.getTime())
      expect(state.startTime!.getTime()).to.be.at.most(after.getTime())
    })

    it('should set execution state to executing', () => {
      stateManager.startExecution()
      expect(stateManager.getExecutionState().executionState).to.equal('executing')
    })
  })

  describe('complete', () => {
    it('should set execution state to complete', () => {
      stateManager.startExecution()
      stateManager.complete(TerminationReason.GOAL)
      expect(stateManager.getExecutionState().executionState).to.equal('complete')
    })

    it('should set termination reason', () => {
      stateManager.startExecution()
      stateManager.complete(TerminationReason.GOAL)
      expect(stateManager.getExecutionState().terminationReason).to.equal(TerminationReason.GOAL)
    })

    it('should set endTime', () => {
      stateManager.startExecution()
      const before = new Date()
      stateManager.complete(TerminationReason.GOAL)
      const after = new Date()

      const state = stateManager.getExecutionState()
      expect(state.endTime).to.be.instanceOf(Date)
      expect(state.endTime!.getTime()).to.be.at.least(before.getTime())
      expect(state.endTime!.getTime()).to.be.at.most(after.getTime())
    })

    it('should calculate durationMs when startTime exists', () => {
      stateManager.startExecution()
      stateManager.complete(TerminationReason.GOAL)
      expect(stateManager.getExecutionState().durationMs).to.be.a('number')
      expect(stateManager.getExecutionState().durationMs).to.be.at.least(0)
    })

    it('should handle MAX_TURNS termination reason', () => {
      stateManager.startExecution()
      stateManager.complete(TerminationReason.MAX_TURNS)
      expect(stateManager.getExecutionState().terminationReason).to.equal(TerminationReason.MAX_TURNS)
    })
  })

  describe('fail', () => {
    it('should set execution state to error', () => {
      stateManager.startExecution()
      stateManager.fail(TerminationReason.ERROR)
      expect(stateManager.getExecutionState().executionState).to.equal('error')
    })

    it('should set termination reason', () => {
      stateManager.startExecution()
      stateManager.fail(TerminationReason.ERROR)
      expect(stateManager.getExecutionState().terminationReason).to.equal(TerminationReason.ERROR)
    })

    it('should set endTime', () => {
      stateManager.startExecution()
      stateManager.fail(TerminationReason.ERROR)
      expect(stateManager.getExecutionState().endTime).to.be.instanceOf(Date)
    })

    it('should calculate durationMs', () => {
      stateManager.startExecution()
      stateManager.fail(TerminationReason.ERROR)
      expect(stateManager.getExecutionState().durationMs).to.be.a('number')
    })
  })

  describe('reset - enhanced', () => {
    it('should reset all FSM-related fields', () => {
      stateManager.startExecution()
      stateManager.incrementToolCalls()
      stateManager.incrementToolCalls()
      stateManager.complete(TerminationReason.GOAL)

      stateManager.reset()

      const state = stateManager.getExecutionState()
      expect(state.executionState).to.equal('idle')
      expect(state.toolCallsExecuted).to.equal(0)
      expect(state.startTime).to.be.undefined
      expect(state.endTime).to.be.undefined
      expect(state.durationMs).to.be.undefined
      expect(state.terminationReason).to.be.undefined
    })
  })

  describe('config management', () => {
    it('should return runtime config', () => {
      const config = stateManager.getRuntimeConfig()
      expect(config.model).to.equal('test-model')
      expect(config.llm.maxTokens).to.equal(8192)
    })

    it('should update LLM config globally', () => {
      stateManager.updateLLM({maxTokens: 4096})

      const config = stateManager.getLLMConfig()
      expect(config.maxTokens).to.equal(4096)
    })

    it('should update LLM config for specific session', () => {
      stateManager.updateLLM({maxTokens: 4096}, 'session-1')

      // Global config should be unchanged
      expect(stateManager.getLLMConfig().maxTokens).to.equal(8192)

      // Session config should have override
      expect(stateManager.getLLMConfig('session-1').maxTokens).to.equal(4096)
    })

    it('should track sessions with overrides', () => {
      stateManager.updateLLM({maxTokens: 4096}, 'session-1')
      stateManager.updateLLM({temperature: 0.5}, 'session-2')

      const sessions = stateManager.getSessionsWithOverrides()
      expect(sessions).to.have.lengthOf(2)
      expect(sessions).to.include('session-1')
      expect(sessions).to.include('session-2')
    })

    it('should clear session override', () => {
      stateManager.updateLLM({maxTokens: 4096}, 'session-1')
      expect(stateManager.hasSessionOverride('session-1')).to.be.true

      stateManager.clearSessionOverride('session-1')
      expect(stateManager.hasSessionOverride('session-1')).to.be.false
    })

    it('should reset to baseline config', () => {
      stateManager.updateLLM({maxTokens: 4096})
      stateManager.updateLLM({temperature: 0.5}, 'session-1')

      stateManager.resetToBaseline()

      expect(stateManager.getLLMConfig().maxTokens).to.equal(8192)
      expect(stateManager.getSessionsWithOverrides()).to.have.lengthOf(0)
    })

    it('should emit stateChanged event on LLM update', () => {
      const emitSpy = sandbox.spy(eventBus, 'emit')

      stateManager.updateLLM({maxTokens: 4096})

      expect(emitSpy.calledWith('cipher:stateChanged')).to.be.true
    })

    it('should emit stateReset event on resetToBaseline', () => {
      const emitSpy = sandbox.spy(eventBus, 'emit')

      stateManager.resetToBaseline()

      expect(emitSpy.calledWith('cipher:stateReset')).to.be.true
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
      const state = stateManager.getExecutionState()
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

      const state = stateManager.getExecutionState()
      expect(state.currentIteration).to.equal(1)
      expect(state.executionHistory).to.deep.equal(['New conversation'])
      expect(iter).to.equal(1)
    })

    it('should track full execution lifecycle with FSM', () => {
      // Start execution
      stateManager.startExecution()
      expect(stateManager.getExecutionState().executionState).to.equal('executing')

      // Simulate tool calls
      stateManager.setExecutionState('tool_calling')
      stateManager.incrementToolCalls()
      stateManager.incrementToolCalls()

      // Back to executing
      stateManager.setExecutionState('executing')
      stateManager.incrementIteration()

      // Complete
      stateManager.complete(TerminationReason.GOAL)

      const state = stateManager.getExecutionState()
      expect(state.executionState).to.equal('complete')
      expect(state.toolCallsExecuted).to.equal(2)
      expect(state.currentIteration).to.equal(1)
      expect(state.terminationReason).to.equal(TerminationReason.GOAL)
      expect(state.durationMs).to.be.a('number')
    })
  })
})
