import {expect} from 'chai'
import {restore, type SinonStub, stub} from 'sinon'

import type {ICipherAgent} from '../../../../../src/agent/core/interfaces/i-cipher-agent.js'

import {estimateTokens} from '../../../../../src/server/infra/executor/pre-compaction/compaction-escalation.js'
import {
  PRE_COMPACTION_CHAR_THRESHOLD,
  PreCompactionService,
} from '../../../../../src/server/infra/executor/pre-compaction/pre-compaction-service.js'

/**
 * Create a mock ICipherAgent with sinon stubs.
 */
function createMockAgent(): {
  agent: ICipherAgent
  createTaskSession: SinonStub
  deleteTaskSession: SinonStub
  executeOnSession: SinonStub
} {
  const createTaskSession = stub().resolves('test-session-id')
  const deleteTaskSession = stub().resolves()
  const executeOnSession = stub().resolves('')

  const agent = {
    cancel: stub().resolves(false),
    createTaskSession,
    deleteSandboxVariable: stub(),
    deleteSandboxVariableOnSession: stub(),
    deleteSession: stub().resolves(true),
    deleteTaskSession,
    execute: stub().resolves(''),
    executeOnSession,
    generate: stub().resolves({content: '', toolCalls: [], usage: {inputTokens: 0, outputTokens: 0}}),
    getSessionMetadata: stub().resolves(),
    getState: stub().returns({currentIteration: 0, executionHistory: [], executionState: 'idle', toolCallsExecuted: 0}),
    listPersistedSessions: stub().resolves([]),
    reset: stub(),
    setSandboxVariable: stub(),
    setSandboxVariableOnSession: stub(),
    start: stub().resolves(),
    stream: stub().resolves({[Symbol.asyncIterator]: () => ({next: () => Promise.resolve({done: true, value: undefined})})}),
  } as unknown as ICipherAgent

  return {agent, createTaskSession, deleteTaskSession, executeOnSession}
}

/**
 * Generate a string of the given length.
 */
function makeText(length: number): string {
  return 'x'.repeat(length)
}

describe('PreCompactionService', () => {
  let service: PreCompactionService

  beforeEach(() => {
    service = new PreCompactionService()
  })

  afterEach(() => {
    restore()
  })

  describe('below threshold', () => {
    it('should skip compaction when context is below threshold', async () => {
      const {agent, createTaskSession} = createMockAgent()
      const shortText = makeText(PRE_COMPACTION_CHAR_THRESHOLD - 1)

      const result = await service.compact(agent, shortText, 'task-123')

      expect(result.preCompacted).to.be.false
      expect(result.context).to.equal(shortText)
      expect(result.originalCharCount).to.equal(shortText.length)
      expect(createTaskSession.called).to.be.false
    })

    it('should skip compaction when context equals threshold', async () => {
      const {agent, createTaskSession} = createMockAgent()
      const exactText = makeText(PRE_COMPACTION_CHAR_THRESHOLD)

      const result = await service.compact(agent, exactText, 'task-123')

      expect(result.preCompacted).to.be.false
      expect(createTaskSession.called).to.be.false
    })
  })

  describe('normal pass succeeds', () => {
    it('should return tier normal when first pass output is shorter and valid', async () => {
      const {agent, deleteTaskSession, executeOnSession} = createMockAgent()
      const longText = makeText(PRE_COMPACTION_CHAR_THRESHOLD + 1000)

      // Return a shorter, valid compaction (>200 chars so it passes unconditionally)
      const compactedText = 'The system implements a three-phase compaction approach. ' +
        'Phase one estimates token counts via character heuristics. ' +
        'Phase two applies LLM-based compression when thresholds are exceeded. ' +
        'Phase three validates output quality before acceptance. ' +
        'Configuration is stored in YAML format.'
      executeOnSession.resolves(compactedText)

      const result = await service.compact(agent, longText, 'task-123')

      expect(result.preCompacted).to.be.true
      expect(result.preCompactionTier).to.equal('normal')
      expect(result.context).to.equal(compactedText.trim())
      expect(result.originalCharCount).to.equal(longText.length)
      expect(deleteTaskSession.calledOnce).to.be.true
    })
  })

  describe('normal fails, aggressive succeeds', () => {
    it('should escalate to aggressive when normal output is too long', async () => {
      const {agent, executeOnSession} = createMockAgent()
      const longText = makeText(PRE_COMPACTION_CHAR_THRESHOLD + 1000)

      // First call: return something longer than input (fails shouldAcceptCompactionOutput)
      const tooLongOutput = makeText(PRE_COMPACTION_CHAR_THRESHOLD + 2000)
      // Second call: return a valid shorter output
      const aggressiveOutput = 'The compaction service reduces context through three escalation levels. ' +
        'Normal compaction preserves detail. Aggressive compaction strips secondary information. ' +
        'Deterministic fallback truncates with binary search. All three are fail-open by design.'
      executeOnSession.onFirstCall().resolves(tooLongOutput)
      executeOnSession.onSecondCall().resolves(aggressiveOutput)

      const result = await service.compact(agent, longText, 'task-123')

      expect(result.preCompacted).to.be.true
      expect(result.preCompactionTier).to.equal('aggressive')
      expect(executeOnSession.calledTwice).to.be.true
    })

    it('should escalate to aggressive when normal output is a refusal', async () => {
      const {agent, executeOnSession} = createMockAgent()
      const longText = makeText(PRE_COMPACTION_CHAR_THRESHOLD + 1000)

      // First call: LLM refusal (fails isCompactionOutputValid)
      executeOnSession.onFirstCall().resolves("I cannot help with that request because the content requires domain expertise.")
      // Second call: valid shorter output
      const aggressiveOutput = 'The compaction service reduces context through three escalation levels. ' +
        'Normal compaction preserves detail. Aggressive compaction strips secondary information. ' +
        'Deterministic fallback truncates with binary search. All three are fail-open by design.'
      executeOnSession.onSecondCall().resolves(aggressiveOutput)

      const result = await service.compact(agent, longText, 'task-123')

      expect(result.preCompacted).to.be.true
      expect(result.preCompactionTier).to.equal('aggressive')
    })
  })

  describe('both fail, deterministic fallback', () => {
    it('should use deterministic fallback when both LLM passes fail', async () => {
      const {agent, executeOnSession} = createMockAgent()
      const longText = makeText(PRE_COMPACTION_CHAR_THRESHOLD + 1000)
      const inputTokens = estimateTokens(longText)

      // Both calls return output that is too long
      executeOnSession.resolves(makeText(PRE_COMPACTION_CHAR_THRESHOLD + 2000))

      const result = await service.compact(agent, longText, 'task-123')

      expect(result.preCompacted).to.be.true
      expect(result.preCompactionTier).to.equal('fallback')
      expect(estimateTokens(result.context)).to.be.lessThan(inputTokens)
      expect(result.context).to.include('truncated from')
    })
  })

  describe('fail-open behavior', () => {
    it('should return original context when first executeOnSession throws', async () => {
      const {agent, executeOnSession} = createMockAgent()
      const longText = makeText(PRE_COMPACTION_CHAR_THRESHOLD + 1000)

      // First call throws — fail-open should return original immediately
      executeOnSession.rejects(new Error('LLM service unavailable'))

      const result = await service.compact(agent, longText, 'task-123')

      // Fail-open: LLM error must return original context, NOT deterministic fallback
      expect(result.preCompacted).to.be.false
      expect(result.context).to.equal(longText)
      expect(result.originalCharCount).to.equal(longText.length)
    })

    it('should fail-open on second pass error even if first pass returned bad output', async () => {
      const {agent, executeOnSession} = createMockAgent()
      const longText = makeText(PRE_COMPACTION_CHAR_THRESHOLD + 1000)

      // First call: LLM responds but output too long (bad output, not error)
      executeOnSession.onFirstCall().resolves(makeText(PRE_COMPACTION_CHAR_THRESHOLD + 2000))
      // Second call: LLM errors
      executeOnSession.onSecondCall().rejects(new Error('LLM timeout'))

      const result = await service.compact(agent, longText, 'task-123')

      // Fail-open: second pass errored, must return original context
      expect(result.preCompacted).to.be.false
      expect(result.context).to.equal(longText)
    })

    it('should use deterministic fallback only when both passes returned bad output (not errors)', async () => {
      const {agent, executeOnSession} = createMockAgent()
      const longText = makeText(PRE_COMPACTION_CHAR_THRESHOLD + 1000)

      // Both calls return output that is too long (bad output, NOT errors)
      executeOnSession.resolves(makeText(PRE_COMPACTION_CHAR_THRESHOLD + 2000))

      const result = await service.compact(agent, longText, 'task-123')

      // Both passes got LLM responses but unacceptable — deterministic fallback is correct
      expect(result.preCompacted).to.be.true
      expect(result.preCompactionTier).to.equal('fallback')
    })

    it('should return original context when createTaskSession throws', async () => {
      const {agent, createTaskSession} = createMockAgent()
      const longText = makeText(PRE_COMPACTION_CHAR_THRESHOLD + 1000)

      createTaskSession.rejects(new Error('Session creation failed'))

      const result = await service.compact(agent, longText, 'task-123')

      expect(result.preCompacted).to.be.false
      expect(result.context).to.equal(longText)
      expect(result.originalCharCount).to.equal(longText.length)
    })
  })

  describe('session cleanup', () => {
    it('should always call deleteTaskSession even on error', async () => {
      const {agent, deleteTaskSession, executeOnSession} = createMockAgent()
      const longText = makeText(PRE_COMPACTION_CHAR_THRESHOLD + 1000)

      // executeOnSession throws to test finally cleanup
      executeOnSession.rejects(new Error('LLM error'))

      await service.compact(agent, longText, 'task-123')

      expect(deleteTaskSession.calledOnce).to.be.true
    })
  })

  describe('task ID isolation', () => {
    it('should create session with __compact suffix for event isolation', async () => {
      const {agent, createTaskSession, executeOnSession} = createMockAgent()
      const longText = makeText(PRE_COMPACTION_CHAR_THRESHOLD + 1000)

      const validOutput = 'The compaction service reduces context through three escalation levels. ' +
        'Normal compaction preserves detail. Aggressive compaction strips secondary information. ' +
        'Deterministic fallback truncates with binary search. All three are fail-open by design.'
      executeOnSession.resolves(validOutput)

      await service.compact(agent, longText, 'task-123')

      expect(createTaskSession.calledOnce).to.be.true
      expect(createTaskSession.firstCall.args[0]).to.equal('task-123__compact')
      expect(createTaskSession.firstCall.args[1]).to.equal('query')
    })
  })

  describe('execution context', () => {
    it('should pass correct execution context to executeOnSession', async () => {
      const {agent, executeOnSession} = createMockAgent()
      const longText = makeText(PRE_COMPACTION_CHAR_THRESHOLD + 1000)

      const validOutput = 'The compaction service reduces context through three escalation levels. ' +
        'Normal compaction preserves detail. Aggressive compaction strips secondary information. ' +
        'Deterministic fallback truncates with binary search. All three are fail-open by design.'
      executeOnSession.resolves(validOutput)

      await service.compact(agent, longText, 'task-123')

      const callOptions = executeOnSession.firstCall.args[2]
      expect(callOptions.executionContext.clearHistory).to.be.true
      expect(callOptions.executionContext.commandType).to.equal('query')
      expect(callOptions.executionContext.maxIterations).to.equal(1)
      expect(callOptions.executionContext.maxTokens).to.equal(4096)
      expect(callOptions.executionContext.temperature).to.equal(0.3)
      expect(callOptions.taskId).to.equal('task-123__compact')
    })
  })
})
