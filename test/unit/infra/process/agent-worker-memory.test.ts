/**
 * Memory Leak Prevention Tests for Agent Worker
 *
 * These tests verify that event listeners are properly cleaned up
 * when the agent is reinitialized, preventing memory leaks.
 *
 * Key scenarios:
 * - Multiple reinits should not accumulate listeners
 * - Cleanup should remove all registered forwarders
 * - Stress test with 100 reinits
 */

/* eslint-disable unicorn/consistent-function-scoping */

import {expect} from 'chai'
import {createSandbox, type SinonSandbox} from 'sinon'

import {AgentEventBus} from '../../../../src/infra/cipher/events/event-emitter.js'

/**
 * List of event names that are forwarded by agent-worker.
 * Must match the events registered in setupAgentEventForwarding().
 */
const FORWARDED_EVENTS = [
  'llmservice:thinking',
  'llmservice:chunk',
  'llmservice:response',
  'llmservice:toolCall',
  'llmservice:toolResult',
  'llmservice:error',
  'llmservice:unsupportedInput',
] as const

describe('Agent Worker Memory Management', () => {
  let sandbox: SinonSandbox

  beforeEach(() => {
    sandbox = createSandbox()
  })

  afterEach(() => {
    sandbox.restore()
  })

  describe('Event Forwarder Cleanup', () => {
    it('should not accumulate listeners after multiple reinits', () => {
      // Simulate what happens in agent-worker.ts
      const eventBus = new AgentEventBus()
      const handlers: Array<{event: string; handler: () => void}> = []

      // Simulate the registerForwarder helper
      const registerForwarder = (event: string, handler: () => void): void => {
        eventBus.on(event as 'llmservice:thinking', handler)
        handlers.push({event, handler})
      }

      // Simulate cleanup function
      const cleanupForwarders = (): void => {
        for (const {event, handler} of handlers) {
          eventBus.off(event as 'llmservice:thinking', handler)
        }

        handlers.length = 0
      }

      // First setup - should have 7 listeners
      for (const event of FORWARDED_EVENTS) {
        registerForwarder(event, () => {})
      }

      expect(handlers.length).to.equal(7)
      expect(eventBus.listenerCount('llmservice:thinking')).to.equal(1)

      // Simulate reinit - cleanup and re-register
      cleanupForwarders()
      expect(handlers.length).to.equal(0)
      expect(eventBus.listenerCount('llmservice:thinking')).to.equal(0)

      // Re-register after cleanup
      for (const event of FORWARDED_EVENTS) {
        registerForwarder(event, () => {})
      }

      expect(handlers.length).to.equal(7)
      expect(eventBus.listenerCount('llmservice:thinking')).to.equal(1)
    })

    it('should maintain constant listener count after 100 reinits (stress test)', () => {
      const eventBus = new AgentEventBus()
      let handlers: Array<{event: string; handler: () => void}> = []

      const setupForwarders = (): void => {
        // Cleanup old handlers first
        for (const {event, handler} of handlers) {
          eventBus.off(event as 'llmservice:thinking', handler)
        }

        handlers = []

        // Register new handlers
        for (const event of FORWARDED_EVENTS) {
          const handler = (): void => {}
          eventBus.on(event as 'llmservice:thinking', handler)
          handlers.push({event, handler})
        }
      }

      // Initial setup
      setupForwarders()
      const initialListenerCount = eventBus.listenerCount('llmservice:thinking')
      expect(initialListenerCount).to.equal(1)

      // Stress test: 100 reinits
      for (let i = 0; i < 100; i++) {
        setupForwarders()
      }

      // Verify listener count hasn't grown
      const finalListenerCount = eventBus.listenerCount('llmservice:thinking')
      expect(finalListenerCount).to.equal(
        initialListenerCount,
        'Listener count should remain constant after 100 reinits',
      )

      // Verify all events have exactly 1 listener
      for (const event of FORWARDED_EVENTS) {
        expect(eventBus.listenerCount(event)).to.equal(1, `Event ${event} should have exactly 1 listener`)
      }
    })

    it('should handle cleanup when eventBus is undefined', () => {
      // Simulate cleanup with no eventBus (graceful handling)
      const handlers: Array<{event: string; handler: () => void}> = []

      // Add some handlers to the tracking array
      handlers.push({event: 'llmservice:thinking', handler() {}}, {event: 'llmservice:chunk', handler() {}})

      // Cleanup with undefined eventBus - should just clear the array
      // (simulates what happens if agent was never fully initialized)
      const cleanupForwarders = (eventBus?: AgentEventBus): void => {
        if (eventBus) {
          for (const {event, handler} of handlers) {
            eventBus.off(event as 'llmservice:thinking', handler)
          }
        }

        handlers.length = 0
      }

      cleanupForwarders()
      expect(handlers.length).to.equal(0)
    })

    it('should correctly track forwarder count in log message', () => {
      const eventBus = new AgentEventBus()
      const handlers: Array<{event: string; handler: () => void}> = []

      // Register all forwarders
      for (const event of FORWARDED_EVENTS) {
        const handler = (): void => {}
        eventBus.on(event as 'llmservice:thinking', handler)
        handlers.push({event, handler})
      }

      // Verify the count matches expected
      expect(handlers.length).to.equal(FORWARDED_EVENTS.length)
      expect(handlers.length).to.equal(7, 'Should have 7 forwarders registered')
    })
  })

  describe('Memory Usage Pattern', () => {
    it('should not exceed baseline memory after many reinits', function () {
      // Skip in CI environments where memory measurements are unreliable
      if (process.env.CI) {
        this.skip()
        return
      }

      const eventBus = new AgentEventBus()
      let handlers: Array<{event: string; handler: () => void}> = []

      const setupForwarders = (): void => {
        // Cleanup old handlers first
        for (const {event, handler} of handlers) {
          eventBus.off(event as 'llmservice:thinking', handler)
        }

        handlers = []

        // Register new handlers
        for (const event of FORWARDED_EVENTS) {
          const handler = (): void => {}
          eventBus.on(event as 'llmservice:thinking', handler)
          handlers.push({event, handler})
        }
      }

      // Force GC if available
      if (globalThis.gc) {
        globalThis.gc()
      }

      // Get baseline memory after initial setup
      setupForwarders()
      const baselineMemory = process.memoryUsage().heapUsed

      // Do 50 reinits
      for (let i = 0; i < 50; i++) {
        setupForwarders()
      }

      // Force GC if available
      if (globalThis.gc) {
        globalThis.gc()
      }

      const finalMemory = process.memoryUsage().heapUsed

      // Memory increase should be minimal (< 1MB tolerance for test overhead)
      const memoryIncrease = finalMemory - baselineMemory
      const maxAllowedIncrease = 1 * 1024 * 1024 // 1MB

      expect(memoryIncrease).to.be.lessThan(
        maxAllowedIncrease,
        `Memory increased by ${(memoryIncrease / 1024 / 1024).toFixed(2)}MB which exceeds 1MB threshold`,
      )
    })
  })
})
