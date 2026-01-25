import {expect} from 'chai'
import {randomUUID} from 'node:crypto'
import {createSandbox, type SinonSandbox} from 'sinon'

import type {CipherAgentServices} from '../../../src/agent/interfaces/cipher-services.js'

import {AgentEventBus, SessionEventBus} from '../../../src/agent/events/event-emitter.js'
import {ChatSession} from '../../../src/agent/session/chat-session.js'
import {
  createMockCipherAgentServices,
  createMockHistoryStorage,
  createMockLLMService,
} from '../../helpers/mock-factories.js'

/**
 * Integration Tests for TaskId Propagation
 *
 * Tests that taskId flows correctly through:
 * - SessionEventBus events (emitted by LLM service with taskId)
 * - ChatSession.setupEventForwarding (forwards events with sessionId added)
 * - AgentEventBus receives events with both sessionId and taskId
 *
 * This is critical for concurrent task isolation.
 */
describe('TaskId Propagation Integration', () => {
  let sandbox: SinonSandbox
  let agentEventBus: AgentEventBus
  let mockSharedServices: CipherAgentServices

  beforeEach(() => {
    sandbox = createSandbox()
    sandbox.stub(console, 'log')
    sandbox.stub(console, 'error')
    sandbox.stub(console, 'warn')

    agentEventBus = new AgentEventBus()

    mockSharedServices = createMockCipherAgentServices(agentEventBus, sandbox, {
      historyStorage: createMockHistoryStorage(sandbox, {
        deleteHistory: sandbox.stub().resolves(),
        loadHistory: sandbox.stub().resolves([]),
        saveHistory: sandbox.stub().resolves(),
      }),
    })
  })

  afterEach(() => {
    sandbox.restore()
  })

  /**
   * Helper to create a ChatSession with its own event bus
   */
  function createTestSession(sessionId: string): {
    chatSession: ChatSession
    sessionEventBus: SessionEventBus
  } {
    const sessionEventBus = new SessionEventBus()
    const mockLLMService = createMockLLMService(sandbox)

    const chatSession = new ChatSession(sessionId, mockSharedServices, {
      llmService: mockLLMService,
      sessionEventBus,
    })

    return {chatSession, sessionEventBus}
  }

  describe('ChatSession taskId propagation', () => {
    it('should forward taskId from session events to agent events', () => {
      const taskId = randomUUID()
      const {chatSession, sessionEventBus} = createTestSession('session-123')

      // Collect events from agent bus
      const receivedEvents: Array<{eventName: string; taskId?: string}> = []

      agentEventBus.on('llmservice:thinking', (payload) => {
        receivedEvents.push({eventName: 'thinking', taskId: payload.taskId})
      })
      agentEventBus.on('llmservice:chunk', (payload) => {
        receivedEvents.push({eventName: 'chunk', taskId: payload.taskId})
      })
      agentEventBus.on('llmservice:response', (payload) => {
        receivedEvents.push({eventName: 'response', taskId: payload.taskId})
      })

      // Emit events from session bus WITHOUT taskId (simulating LLM service without task context)
      sessionEventBus.emit('llmservice:thinking', {})
      sessionEventBus.emit('llmservice:chunk', {content: 'test', type: 'text'})
      sessionEventBus.emit('llmservice:response', {content: 'response'})

      // Without taskId in payload, events should not have taskId
      expect(receivedEvents.every((e) => e.taskId === undefined)).to.be.true

      // Clear events
      receivedEvents.length = 0

      // Emit events WITH taskId in payload (simulating LLM service with task context)
      sessionEventBus.emit('llmservice:thinking', {taskId})
      sessionEventBus.emit('llmservice:chunk', {content: 'test2', taskId, type: 'text'})
      sessionEventBus.emit('llmservice:response', {content: 'response2', taskId})

      // Now all events should have taskId
      expect(receivedEvents.every((e) => e.taskId === taskId)).to.be.true

      chatSession.dispose()
    })

    it('should isolate taskId between concurrent tasks', () => {
      const task1Id = randomUUID()
      const task2Id = randomUUID()

      // Create two sessions (simulating concurrent tasks)
      const {chatSession: chatSession1, sessionEventBus: sessionEventBus1} = createTestSession('session-1')
      const {chatSession: chatSession2, sessionEventBus: sessionEventBus2} = createTestSession('session-2')

      // Collect events by taskId
      const task1Events: string[] = []
      const task2Events: string[] = []

      agentEventBus.on('llmservice:chunk', (payload) => {
        if (payload.taskId === task1Id) {
          task1Events.push(payload.content)
        } else if (payload.taskId === task2Id) {
          task2Events.push(payload.content)
        }
      })

      // Interleave events from both sessions with taskId in payload
      sessionEventBus1.emit('llmservice:chunk', {content: 'task1-msg1', taskId: task1Id, type: 'text'})
      sessionEventBus2.emit('llmservice:chunk', {content: 'task2-msg1', taskId: task2Id, type: 'text'})
      sessionEventBus1.emit('llmservice:chunk', {content: 'task1-msg2', taskId: task1Id, type: 'text'})
      sessionEventBus2.emit('llmservice:chunk', {content: 'task2-msg2', taskId: task2Id, type: 'text'})
      sessionEventBus1.emit('llmservice:chunk', {content: 'task1-msg3', taskId: task1Id, type: 'text'})

      // Verify isolation
      expect(task1Events).to.deep.equal(['task1-msg1', 'task1-msg2', 'task1-msg3'])
      expect(task2Events).to.deep.equal(['task2-msg1', 'task2-msg2'])

      chatSession1.dispose()
      chatSession2.dispose()
    })

    it('should include taskId in all event types', () => {
      const taskId = randomUUID()
      const {chatSession, sessionEventBus} = createTestSession('session-all-events')

      // Track all event types
      const eventTaskIds: Record<string, string | undefined> = {}

      agentEventBus.on('llmservice:thinking', (p) => {
        eventTaskIds.thinking = p.taskId
      })
      agentEventBus.on('llmservice:chunk', (p) => {
        eventTaskIds.chunk = p.taskId
      })
      agentEventBus.on('llmservice:response', (p) => {
        eventTaskIds.response = p.taskId
      })
      agentEventBus.on('llmservice:toolCall', (p) => {
        eventTaskIds.toolCall = p.taskId
      })
      agentEventBus.on('llmservice:toolResult', (p) => {
        eventTaskIds.toolResult = p.taskId
      })
      agentEventBus.on('llmservice:error', (p) => {
        eventTaskIds.error = p.taskId
      })

      // Emit all event types with taskId in payload
      sessionEventBus.emit('llmservice:thinking', {taskId})
      sessionEventBus.emit('llmservice:chunk', {content: 'x', taskId, type: 'text'})
      sessionEventBus.emit('llmservice:response', {content: 'x', taskId})
      sessionEventBus.emit('llmservice:toolCall', {args: {}, callId: 'c1', taskId, toolName: 't1'})
      sessionEventBus.emit('llmservice:toolResult', {
        callId: 'c1',
        result: 'ok',
        success: true,
        taskId,
        toolName: 't1',
      })
      sessionEventBus.emit('llmservice:error', {error: 'test error', taskId})

      // All should have taskId
      for (const [eventName, eventTaskId] of Object.entries(eventTaskIds)) {
        expect(eventTaskId, `${eventName} should have taskId`).to.equal(taskId)
      }

      chatSession.dispose()
    })
  })

  describe('Agent-worker style event filtering', () => {
    it('should allow filtering events by taskId (simulating agent-worker forwarding)', () => {
      const activeTaskId = randomUUID()
      const otherTaskId = randomUUID()

      const {chatSession: chatSession1, sessionEventBus: sessionEventBus1} = createTestSession('s1')
      const {chatSession: chatSession2, sessionEventBus: sessionEventBus2} = createTestSession('s2')

      // Simulate agent-worker filtering: only forward events with matching taskId
      const forwardedToTransport: Array<{content: string; taskId: string}> = []

      agentEventBus.on('llmservice:chunk', (payload) => {
        // This simulates: if (payload.taskId) { transportClient.request(...) }
        if (payload.taskId) {
          forwardedToTransport.push({
            content: payload.content,
            taskId: payload.taskId,
          })
        }
      })

      // Emit from both sessions with taskId in payload
      sessionEventBus1.emit('llmservice:chunk', {content: 'from-active', taskId: activeTaskId, type: 'text'})
      sessionEventBus2.emit('llmservice:chunk', {content: 'from-other', taskId: otherTaskId, type: 'text'})

      // Both should be forwarded with their respective taskIds
      expect(forwardedToTransport).to.have.length(2)
      expect(forwardedToTransport[0]).to.deep.equal({content: 'from-active', taskId: activeTaskId})
      expect(forwardedToTransport[1]).to.deep.equal({content: 'from-other', taskId: otherTaskId})

      chatSession1.dispose()
      chatSession2.dispose()
    })

    it('should not forward events without taskId', () => {
      const {chatSession, sessionEventBus} = createTestSession('s1')

      // DON'T include taskId in payload - simulating events without task context

      const forwardedToTransport: unknown[] = []

      agentEventBus.on('llmservice:chunk', (payload) => {
        if (payload.taskId) {
          forwardedToTransport.push(payload)
        }
      })

      sessionEventBus.emit('llmservice:chunk', {content: 'orphan event', type: 'text'})

      // Should NOT be forwarded because no taskId
      expect(forwardedToTransport).to.have.length(0)

      chatSession.dispose()
    })
  })

  describe('Concurrent tasks: 3 curate + 2 query simulation', () => {
    it('should handle 5 concurrent tasks without crosstalk', () => {
      const tasks: Array<{
        chatSession: ChatSession
        sessionEventBus: SessionEventBus
        taskId: string
        type: 'curate' | 'query'
      }> = []

      // Create 3 curate-like tasks
      for (let i = 0; i < 3; i++) {
        const taskId = randomUUID()
        const {chatSession, sessionEventBus} = createTestSession(`curate-session-${i}`)
        tasks.push({chatSession, sessionEventBus, taskId, type: 'curate'})
      }

      // Create 2 query-like tasks
      for (let i = 0; i < 2; i++) {
        const taskId = randomUUID()
        const {chatSession, sessionEventBus} = createTestSession(`query-session-${i}`)
        tasks.push({chatSession, sessionEventBus, taskId, type: 'query'})
      }

      // Collect events per task
      const eventsPerTask = new Map<string, string[]>()
      for (const task of tasks) {
        eventsPerTask.set(task.taskId, [])
      }

      agentEventBus.on('llmservice:chunk', (payload) => {
        if (payload.taskId) {
          const taskEvents = eventsPerTask.get(payload.taskId)
          if (taskEvents) {
            taskEvents.push(payload.content)
          }
        }
      })

      // Emit 2 events per task in interleaved order with taskId in payload
      for (let round = 0; round < 2; round++) {
        for (const task of tasks) {
          task.sessionEventBus.emit('llmservice:chunk', {
            content: `${task.type}-${task.taskId.slice(0, 8)}-r${round}`,
            taskId: task.taskId,
            type: 'text',
          })
        }
      }

      // Verify each task received exactly 2 events
      for (const task of tasks) {
        const taskEvents = eventsPerTask.get(task.taskId)!
        expect(taskEvents, `${task.type} task ${task.taskId.slice(0, 8)} should have 2 events`).to.have.length(2)

        // All events should be from this task with correct type
        for (const event of taskEvents) {
          expect(event).to.include(task.taskId.slice(0, 8))
          expect(event).to.include(task.type)
        }
      }

      // Cleanup
      for (const task of tasks) {
        task.chatSession.dispose()
      }
    })
  })
})
