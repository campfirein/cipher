import {expect} from 'chai'

import {SessionEventBus} from '../../../../../src/agent/infra/events/event-emitter.js'
import {SessionProgressTracker} from '../../../../../src/agent/infra/llm/context/session-progress-tracker.js'

describe('SessionProgressTracker', () => {
  let eventBus: SessionEventBus
  let tracker: SessionProgressTracker

  beforeEach(() => {
    eventBus = new SessionEventBus()
    tracker = new SessionProgressTracker(eventBus)
    tracker.attach()
  })

  afterEach(() => {
    tracker.detach()
  })

  describe('initial state', () => {
    it('should start with all counters at zero', () => {
      const snapshot = tracker.getSnapshot()

      expect(snapshot.iterationCount).to.equal(0)
      expect(snapshot.toolCallCount).to.equal(0)
      expect(snapshot.toolSuccessCount).to.equal(0)
      expect(snapshot.toolFailureCount).to.equal(0)
      expect(snapshot.compressionCount).to.equal(0)
      expect(snapshot.doomLoopCount).to.equal(0)
      expect(snapshot.errorCount).to.equal(0)
      expect(snapshot.tokenUtilizationHistory).to.deep.equal([])
      expect(snapshot.topTools).to.deep.equal([])
    })
  })

  describe('recordIteration()', () => {
    it('should increment iteration count', () => {
      tracker.recordIteration()
      tracker.recordIteration()
      tracker.recordIteration()

      expect(tracker.getSnapshot().iterationCount).to.equal(3)
    })
  })

  describe('tool result tracking', () => {
    it('should count successful tool calls', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      eventBus.emit('llmservice:toolResult' as any, {success: true, toolName: 'read_file'})
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      eventBus.emit('llmservice:toolResult' as any, {success: true, toolName: 'grep_content'})

      const snapshot = tracker.getSnapshot()

      expect(snapshot.toolCallCount).to.equal(2)
      expect(snapshot.toolSuccessCount).to.equal(2)
      expect(snapshot.toolFailureCount).to.equal(0)
    })

    it('should count failed tool calls', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      eventBus.emit('llmservice:toolResult' as any, {success: false, toolName: 'code_exec'})

      const snapshot = tracker.getSnapshot()

      expect(snapshot.toolCallCount).to.equal(1)
      expect(snapshot.toolFailureCount).to.equal(1)
      expect(snapshot.toolSuccessCount).to.equal(0)
    })

    it('should track top tools by call count', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      eventBus.emit('llmservice:toolResult' as any, {success: true, toolName: 'read_file'})
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      eventBus.emit('llmservice:toolResult' as any, {success: true, toolName: 'read_file'})
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      eventBus.emit('llmservice:toolResult' as any, {success: true, toolName: 'grep_content'})

      const snapshot = tracker.getSnapshot()

      expect(snapshot.topTools).to.have.length(2)
      expect(snapshot.topTools[0]).to.deep.equal({count: 2, name: 'read_file'})
      expect(snapshot.topTools[1]).to.deep.equal({count: 1, name: 'grep_content'})
    })
  })

  describe('context overflow tracking', () => {
    it('should record token utilization from contextOverflow events', () => {
      eventBus.emit('llmservice:contextOverflow', {
        currentTokens: 80_000,
        maxTokens: 100_000,
        taskId: 'test',
        utilizationPercent: 80,
      })
      eventBus.emit('llmservice:contextOverflow', {
        currentTokens: 90_000,
        maxTokens: 100_000,
        taskId: 'test',
        utilizationPercent: 90,
      })

      const snapshot = tracker.getSnapshot()

      expect(snapshot.tokenUtilizationHistory).to.deep.equal([80, 90])
    })

    it('should cap utilization history at maxUtilizationHistory', () => {
      const smallTracker = new SessionProgressTracker(eventBus, {maxUtilizationHistory: 3})
      smallTracker.attach()

      for (let i = 1; i <= 5; i++) {
        eventBus.emit('llmservice:contextOverflow', {
          currentTokens: i * 1000,
          maxTokens: 10_000,
          taskId: 'test',
          utilizationPercent: i * 10,
        })
      }

      const snapshot = smallTracker.getSnapshot()

      expect(snapshot.tokenUtilizationHistory).to.have.length(3)
      expect(snapshot.tokenUtilizationHistory).to.deep.equal([30, 40, 50])
      smallTracker.detach()
    })
  })

  describe('compression tracking', () => {
    it('should count contextCompressed events', () => {
      eventBus.emit('llmservice:contextCompressed', {
        compressedTokens: 5000,
        originalTokens: 10_000,
        strategy: 'summary',
      })

      expect(tracker.getSnapshot().compressionCount).to.equal(1)
    })

    it('should count compressionQuality events', () => {
      eventBus.emit('llmservice:compressionQuality', {
        dimensions: {factualCompleteness: 0.8, toolContextPreservation: 0.9, userIntentClarity: 0.7},
        overallScore: 0.8,
      })

      expect(tracker.getSnapshot().compressionCount).to.equal(1)
    })
  })

  describe('doom loop and error tracking', () => {
    it('should count doom loop detections', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      eventBus.emit('llmservice:doomLoopDetected' as any, {})

      expect(tracker.getSnapshot().doomLoopCount).to.equal(1)
    })

    it('should count LLM errors', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      eventBus.emit('llmservice:error' as any, {error: 'test error', taskId: 'test'})

      expect(tracker.getSnapshot().errorCount).to.equal(1)
    })
  })

  describe('detach()', () => {
    it('should stop counting events after detach', () => {
      tracker.detach()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      eventBus.emit('llmservice:toolResult' as any, {success: true, toolName: 'read_file'})

      expect(tracker.getSnapshot().toolCallCount).to.equal(0)
    })
  })
})
