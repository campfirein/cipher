import {expect} from 'chai'
import {beforeEach, describe, it} from 'mocha'

import type {InternalMessage} from '../../src/core/interfaces/cipher/message-types.js'

import {ContextManager} from '../../src/infra/cipher/llm/context/context-manager.js'
import {GeminiMessageFormatter} from '../../src/infra/cipher/llm/formatters/gemini-formatter.js'
import {GeminiTokenizer} from '../../src/infra/cipher/llm/tokenizers/gemini-tokenizer.js'

/**
 * Integration test to verify tool results flow correctly through the context manager
 * and are available for subsequent tools.
 *
 * This test simulates the agentic loop:
 * 1. User asks a question
 * 2. LLM calls find_knowledge_topics tool
 * 3. Tool result is added to context
 * 4. LLM sees the result and can use it for next iteration
 */
describe('Tool Context Flow Integration', () => {
  let contextManager: ContextManager<unknown>
  const sessionId = 'test-tool-flow-session'

  beforeEach(async () => {
    // Create a fresh context manager for each test
    const formatter = new GeminiMessageFormatter()
    const tokenizer = new GeminiTokenizer('gemini-2.0-flash')

    contextManager = new ContextManager({
      formatter,
      maxInputTokens: 1_000_000,
      sessionId,
      tokenizer,
    })

    await contextManager.initialize()
  })

  describe('Tool Result Storage and Retrieval', () => {
    it('should store tool results in conversation history', async () => {
      // Simulate user message
      await contextManager.addUserMessage('Find all topics about testing')

      // Simulate assistant calling find_knowledge_topics tool
      await contextManager.addAssistantMessage('', [
        {
          function: {
            arguments: JSON.stringify({topicPattern: 'test'}),
            name: 'find_knowledge_topics',
          },
          id: 'call_123',
          type: 'function',
        },
      ])

      // Simulate tool result
      const toolResult = {
        results: [
          {domain: 'testing', path: 'testing/unit_tests', topic: 'unit_tests'},
          {domain: 'testing', path: 'testing/integration_tests', topic: 'integration_tests'},
        ],
        total: 2,
      }

      await contextManager.addToolResult('call_123', 'find_knowledge_topics', toolResult, {success: true})

      // Verify the result is in the message history
      const messages = contextManager.getMessages()

      expect(messages).to.have.length(3)
      expect(messages[2].role).to.equal('tool')
      expect(messages[2].name).to.equal('find_knowledge_topics')
      expect(messages[2].toolCallId).to.equal('call_123')

      // Verify the content is properly serialized
      const content = messages[2].content as string
      expect(content).to.include('unit_tests')
      expect(content).to.include('integration_tests')
      expect(content).to.include('testing/unit_tests')
    })

    it('should make tool results available in formatted messages', async () => {
      // Add user message
      await contextManager.addUserMessage('Find testing topics')

      // Add assistant tool call
      await contextManager.addAssistantMessage('', [
        {
          function: {
            arguments: JSON.stringify({domain: 'testing'}),
            name: 'find_knowledge_topics',
          },
          id: 'call_456',
          type: 'function',
        },
      ])

      // Add tool result
      const toolResult = {
        results: [{domain: 'testing', path: 'testing/unit_tests', topic: 'unit_tests'}],
        total: 1,
      }
      await contextManager.addToolResult('call_456', 'find_knowledge_topics', toolResult, {success: true})

      // Get formatted messages (as would be sent to LLM)
      const {formattedMessages} = await contextManager.getFormattedMessagesWithCompression()

      // Should have: user message, assistant message with tool call, tool result
      expect(formattedMessages).to.have.length.at.least(3)

      // The tool result should be in the formatted messages
      const toolResultMessage = formattedMessages[2] as {parts?: Array<{functionResponse?: {name: string}}>; role: string}
      expect(toolResultMessage.role).to.equal('user') // Gemini formats tool results as user messages
      expect(toolResultMessage.parts).to.exist
      expect(toolResultMessage.parts?.[0].functionResponse).to.exist
      expect(toolResultMessage.parts?.[0].functionResponse?.name).to.equal('find_knowledge_topics')
    })

    it('should preserve tool results through multiple iterations', async () => {
      // Iteration 1: Find topics
      await contextManager.addUserMessage('Find testing topics and read the first one')

      await contextManager.addAssistantMessage('', [
        {
          function: {
            arguments: JSON.stringify({domain: 'testing'}),
            name: 'find_knowledge_topics',
          },
          id: 'call_1',
          type: 'function',
        },
      ])

      const findResult = {
        results: [{domain: 'testing', path: 'testing/unit_tests', topic: 'unit_tests'}],
        total: 1,
      }
      await contextManager.addToolResult('call_1', 'find_knowledge_topics', findResult, {success: true})

      // Iteration 2: Read file (uses result from find_knowledge_topics)
      await contextManager.addAssistantMessage('', [
        {
          function: {
            arguments: JSON.stringify({path: '.brv/context-tree/testing/unit_tests/context.md'}),
            name: 'read_file',
          },
          id: 'call_2',
          type: 'function',
        },
      ])

      const readResult = 'Unit testing best practices:\n- Use descriptive test names\n- Follow AAA pattern'
      await contextManager.addToolResult('call_2', 'read_file', readResult, {success: true})

      // Get all messages
      const messages = contextManager.getMessages()

      // Should have:
      // 1. User message
      // 2. Assistant with find_knowledge_topics call
      // 3. Tool result for find_knowledge_topics
      // 4. Assistant with read_file call
      // 5. Tool result for read_file
      expect(messages).to.have.length(5)

      // Verify both tool results are present
      const toolMessages = messages.filter((m: InternalMessage) => m.role === 'tool')
      expect(toolMessages).to.have.length(2)

      // First tool result
      expect(toolMessages[0].name).to.equal('find_knowledge_topics')
      expect(toolMessages[0].content).to.include('unit_tests')

      // Second tool result
      expect(toolMessages[1].name).to.equal('read_file')
      expect(toolMessages[1].content).to.include('AAA pattern')
    })

    it('should handle structured tool results with output guidance', async () => {
      await contextManager.addUserMessage('List available topics')

      await contextManager.addAssistantMessage('', [
        {
          function: {arguments: JSON.stringify({}), name: 'find_knowledge_topics'},
          id: 'call_789',
          type: 'function',
        },
      ])

      // Simulate tool result with guidance (as returned by ToolProvider)
      const toolResultWithGuidance = {
        guidance:
          'You have retrieved knowledge topics. Consider if you need to:\n- Read specific topic content\n- Filter further',
        result: {
          results: [
            {domain: 'testing', path: 'testing/unit_tests', topic: 'unit_tests'},
            {domain: 'architecture', path: 'architecture/patterns', topic: 'patterns'},
          ],
          total: 2,
        },
      }

      await contextManager.addToolResult('call_789', 'find_knowledge_topics', toolResultWithGuidance, {
        success: true,
      })

      // Verify the guidance is included in the stored content
      const messages = contextManager.getMessages()
      const toolMessage = messages.find((m: InternalMessage) => m.role === 'tool')

      expect(toolMessage).to.exist
      const content = toolMessage!.content as string
      expect(content).to.include('guidance')
      expect(content).to.include('Read specific topic content')
      expect(content).to.include('unit_tests')
      expect(content).to.include('patterns')
    })

    it('should truncate very large tool results', async () => {
      await contextManager.addUserMessage('Get all data')

      await contextManager.addAssistantMessage('', [
        {
          function: {arguments: JSON.stringify({}), name: 'find_knowledge_topics'},
          id: 'call_large',
          type: 'function',
        },
      ])

      // Create a very large result (>50K characters)
      const largeArray = Array.from({length: 10_000}).map((_, i) => ({
        domain: `domain_${i}`,
        path: `domain_${i}/topic_${i}`,
        topic: `topic_${i}`,
      }))

      const largeResult = {results: largeArray, total: 10_000}

      await contextManager.addToolResult('call_large', 'find_knowledge_topics', largeResult, {success: true})

      // Verify the content is truncated
      const messages = contextManager.getMessages()
      const toolMessage = messages.find((m: InternalMessage) => m.role === 'tool')

      expect(toolMessage).to.exist
      const content = toolMessage!.content as string

      // Should be truncated to 50K characters + truncation notice
      expect(content.length).to.be.lessThan(51_000)
      expect(content).to.include('(truncated)')
    })

    it('should handle tool execution errors gracefully', async () => {
      await contextManager.addUserMessage('Find topics')

      await contextManager.addAssistantMessage('', [
        {
          function: {arguments: JSON.stringify({invalid: 'params'}), name: 'find_knowledge_topics'},
          id: 'call_error',
          type: 'function',
        },
      ])

      // Simulate error result
      const errorMessage = 'Error: Invalid parameter "invalid". Expected one of: domain, domainPattern, topicPattern'

      await contextManager.addToolResult('call_error', 'find_knowledge_topics', errorMessage, {success: false})

      // Verify error is stored
      const messages = contextManager.getMessages()
      const toolMessage = messages.find((m: InternalMessage) => m.role === 'tool')

      expect(toolMessage).to.exist
      expect(toolMessage!.content).to.include('Error')
      expect(toolMessage!.content).to.include('Invalid parameter')
    })
  })

  describe('Tool Chaining Simulation', () => {
    it('should support sequential tool calls with dependent data', async () => {
      // User wants to find and read topics
      await contextManager.addUserMessage('Find all testing topics and show me the content of unit_tests')

      // Step 1: find_knowledge_topics
      await contextManager.addAssistantMessage('Let me find the testing topics first', [
        {
          function: {arguments: JSON.stringify({domain: 'testing', includeSubtopics: true}), name: 'find_knowledge_topics'},
          id: 'call_find',
          type: 'function',
        },
      ])

      await contextManager.addToolResult(
        'call_find',
        'find_knowledge_topics',
        {
          results: [
            {
              domain: 'testing',
              path: 'testing/unit_tests',
              subtopics: [{name: 'mocking', path: 'testing/unit_tests/mocking'}],
              topic: 'unit_tests',
            },
          ],
          total: 1,
        },
        {success: true},
      )

      // Step 2: read_file (uses path from previous result)
      await contextManager.addAssistantMessage('Now let me read the unit_tests content', [
        {
          function: {
            arguments: JSON.stringify({path: '.brv/context-tree/testing/unit_tests/context.md'}),
            name: 'read_file',
          },
          id: 'call_read',
          type: 'function',
        },
      ])

      await contextManager.addToolResult(
        'call_read',
        'read_file',
        'Unit Testing Guidelines:\n\n## Best Practices\n- Write descriptive test names\n- Use AAA pattern\n- Mock external dependencies',
        {success: true},
      )

      // Step 3: Final response (synthesizes both results)
      await contextManager.addAssistantMessage(
        'Based on the knowledge structure, here is what I found:\n\n' +
          'The testing domain has a unit_tests topic with a mocking subtopic. ' +
          'The unit testing guidelines emphasize using the AAA pattern and mocking external dependencies.',
      )

      // Verify complete conversation flow
      const messages = contextManager.getMessages()

      // Should have 7 messages:
      // 1. User
      // 2. Assistant with find call
      // 3. find result
      // 4. Assistant with read call
      // 5. read result
      // 6. Final assistant response
      expect(messages).to.have.length(6)

      // Verify message sequence
      expect(messages[0].role).to.equal('user')
      expect(messages[1].role).to.equal('assistant')
      expect(messages[1].toolCalls).to.have.length(1)
      expect(messages[2].role).to.equal('tool')
      expect(messages[2].name).to.equal('find_knowledge_topics')
      expect(messages[3].role).to.equal('assistant')
      expect(messages[3].toolCalls).to.have.length(1)
      expect(messages[4].role).to.equal('tool')
      expect(messages[4].name).to.equal('read_file')
      expect(messages[5].role).to.equal('assistant')
      expect(messages[5].content).to.include('AAA pattern')
    })
  })
})
