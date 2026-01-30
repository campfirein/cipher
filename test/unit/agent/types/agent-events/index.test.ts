import {expect} from 'chai'
import {expectTypeOf} from 'expect-type'

import type {
  AgentEventMap,
  AgentEventName,
  EventName,
  SessionEventMap,
  SessionEventName,
  TokenUsage,
} from '../../../../../src/agent/core/domain/agent-events/index.js'

import {
  AGENT_EVENT_NAMES,
  EVENT_NAMES,
  SESSION_EVENT_NAMES,
} from '../../../../../src/agent/core/domain/agent-events/index.js'

describe('cipher/agent-events/index', () => {
  describe('Exports', () => {
    it('should export all expected type exports', () => {
      // Verify types are exported
      const agentEventName: AgentEventName = 'cipher:conversationReset'
      const sessionEventName: SessionEventName = 'llmservice:thinking'
      const eventName: EventName = 'cipher:conversationReset'
      const tokenUsage: TokenUsage = {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      }

      expectTypeOf<AgentEventName>(agentEventName)
      expectTypeOf<SessionEventName>(sessionEventName)
      expectTypeOf<EventName>(eventName)
      expectTypeOf<TokenUsage>(tokenUsage)
    })

    it('should export all expected constant exports', () => {
      expect(AGENT_EVENT_NAMES).to.exist
      expect(SESSION_EVENT_NAMES).to.exist
      expect(EVENT_NAMES).to.exist
    })

    it('should export AgentEventMap type', () => {
      const payload: AgentEventMap['cipher:conversationReset'] = {
        sessionId: 'session-123',
      }

      expectTypeOf<AgentEventMap['cipher:conversationReset']>(payload)
    })

    it('should export SessionEventMap type', () => {
      const payload: SessionEventMap['llmservice:thinking'] = {}

      expectTypeOf<SessionEventMap['llmservice:thinking']>(payload)
    })
  })

  describe('Re-export Verification', () => {
    it('should re-export types from types.ts correctly', () => {
      // Verify all types are accessible through index
      const agentEvent: AgentEventName = 'cipher:stateChanged'
      const sessionEvent: SessionEventName = 'llmservice:chunk'
      const allEvent: EventName = 'cipher:conversationReset'

      expectTypeOf<AgentEventName>(agentEvent)
      expectTypeOf<SessionEventName>(sessionEvent)
      expectTypeOf<EventName>(allEvent)
    })

    it('should re-export constants from types.ts correctly', () => {
      // Verify constants match expected values
      expect(AGENT_EVENT_NAMES).to.be.an('array')
      expect(SESSION_EVENT_NAMES).to.be.an('array')
      expect(EVENT_NAMES).to.be.an('array')

      // Verify they contain expected events
      expect(AGENT_EVENT_NAMES).to.include('cipher:conversationReset')
      expect(SESSION_EVENT_NAMES).to.include('llmservice:thinking')
      expect(EVENT_NAMES).to.include('cipher:conversationReset')
      expect(EVENT_NAMES).to.include('llmservice:thinking')
    })
  })

  describe('Index File Completeness', () => {
    it('should export all types that are in types.ts', () => {
      // This test ensures index.ts is a complete re-export
      // If a type is missing, TypeScript will fail at compile time
      // We verify by using the types in assignments
      const agentEventName: AgentEventName = 'cipher:conversationReset'
      const sessionEventName: SessionEventName = 'llmservice:thinking'
      const eventName: EventName = 'cipher:stateChanged'
      const tokenUsage: TokenUsage = {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      }
      const agentPayload: AgentEventMap['cipher:conversationReset'] = {
        sessionId: 'session-123',
      }
      const sessionPayload: SessionEventMap['llmservice:thinking'] = {}

      expectTypeOf<AgentEventName>(agentEventName)
      expectTypeOf<SessionEventName>(sessionEventName)
      expectTypeOf<EventName>(eventName)
      expectTypeOf<TokenUsage>(tokenUsage)
      expectTypeOf<AgentEventMap['cipher:conversationReset']>(agentPayload)
      expectTypeOf<SessionEventMap['llmservice:thinking']>(sessionPayload)
    })

    it('should export all constants that are in types.ts', () => {
      // This test ensures index.ts exports all constants
      const allConstants = {
        AGENT_EVENT_NAMES,
        EVENT_NAMES,
        SESSION_EVENT_NAMES,
      }

      expect(allConstants).to.exist
      expect(allConstants.AGENT_EVENT_NAMES).to.exist
      expect(allConstants.EVENT_NAMES).to.exist
      expect(allConstants.SESSION_EVENT_NAMES).to.exist
    })
  })
})

