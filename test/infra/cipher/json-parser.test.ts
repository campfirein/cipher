/* eslint-disable camelcase */
import {expect} from 'chai'
import {afterEach, beforeEach, describe, it} from 'mocha'
import fs from 'node:fs'
import {restore, SinonStub, stub} from 'sinon'

import {parseCursorConversation} from '../../../src/infra/cipher/json-parser.js'

describe('parseCursorConversation', () => {
  let readFileSyncStub: SinonStub

  beforeEach(() => {
    readFileSyncStub = stub(fs, 'readFileSync')
  })

  afterEach(() => {
    restore()
  })

  it('should parse a valid Cursor conversation with text messages', () => {
    const mockConversation = {
      id: 'test-conversation-id',
      messages: [
        {
          content: [{text: 'Hello', type: 'text'}],
          timestamp: '2025-11-07T00:24:05.989Z',
          turn_id: 1,
          type: 'user',
        },
        {
          content: [{text: 'Hi there!', type: 'text'}],
          timestamp: '2025-11-07T00:24:06.989Z',
          turn_id: 2,
          type: 'assistant',
        },
      ],
      timestamp: 1_762_411_514_109,
      title: 'Test Conversation',
      type: 'Cursor',
    }

    readFileSyncStub.returns(JSON.stringify(mockConversation))

    const result = parseCursorConversation('test.json')

    expect(result.currentPrompt).to.equal('Hello')
    expect(result.history).to.have.lengthOf(2)
    expect(result.history[0]).to.deep.include({
      content: 'Hello',
      role: 'user',
    })
    expect(result.history[1]).to.deep.include({
      content: 'Hi there!',
      role: 'assistant',
    })
    expect(result.metadata).to.deep.equal({
      conversationId: 'test-conversation-id',
      title: 'Test Conversation',
      type: 'Cursor',
    })
  })

  it('should parse conversation with tool calls', () => {

    const mockConversation = {
      id: 'tool-conversation',
      messages: [
        {
          content: [{text: 'List files', type: 'text'}],
          timestamp: '2025-11-07T00:24:05.989Z',
          turn_id: 1,
          type: 'user',
        },
        {
          content: [
            {
              id: 'tool_123',
              input: {targetDirectory: '/path'},
              name: 'list_dir',
              output: {
                content: {files: ['file1.ts', 'file2.ts']},
                type: 'tool_result',
              },
              type: 'tool_use',
            },
          ],
          timestamp: '2025-11-07T00:24:06.989Z',
          turn_id: 2,
          type: 'assistant',
        },
      ],
      timestamp: 1_762_411_514_109,
      title: 'Tool Test',
      type: 'Cursor',
    }

    readFileSyncStub.returns(JSON.stringify(mockConversation))

    const result = parseCursorConversation('test.json')

    expect(result.history).to.have.lengthOf(3)

    // User message
    expect(result.history[0]).to.deep.include({
      content: 'List files',
      role: 'user',
    })

    // Assistant message with tool call
    const assistantMsg = result.history[1]
    expect(assistantMsg.role).to.equal('assistant')
    expect(assistantMsg.content).to.be.null
    expect(assistantMsg.toolCalls).to.have.lengthOf(1)
    expect(assistantMsg.toolCalls?.[0]).to.deep.equal({
      function: {
        arguments: JSON.stringify({targetDirectory: '/path'}),
        name: 'list_dir',
      },
      id: 'tool_123',
      type: 'function',
    })

    // Tool result message
    const toolMsg = result.history[2]
    expect(toolMsg.role).to.equal('tool')
    expect(toolMsg.name).to.equal('list_dir')
    expect(toolMsg.toolCallId).to.equal('tool_123')
    expect(JSON.parse(toolMsg.content as string)).to.deep.equal({
      files: ['file1.ts', 'file2.ts'],
    })
  })

  it('should sort messages by turn_id', () => {

    const mockConversation = {
      id: 'sort-test',
      messages: [
        {
          content: [{text: 'Second', type: 'text'}],
          timestamp: '2025-11-07T00:24:06.989Z',
          turn_id: 2,
          type: 'user',
        },
        {
          content: [{text: 'First', type: 'text'}],
          timestamp: '2025-11-07T00:24:05.989Z',
          turn_id: 1,
          type: 'user',
        },
      ],
      timestamp: 1_762_411_514_109,
      title: 'Sort Test',
      type: 'Cursor',
    }

    readFileSyncStub.returns(JSON.stringify(mockConversation))

    const result = parseCursorConversation('test.json')

    expect(result.history[0].content).to.equal('First')
    expect(result.history[1].content).to.equal('Second')
    expect(result.currentPrompt).to.equal('Second')
  })

  it('should throw error if file does not exist', () => {
    readFileSyncStub.throws({code: 'ENOENT', message: 'File not found'})

    expect(() => parseCursorConversation('nonexistent.json')).to.throw('File not found')
  })

  it('should throw error for invalid JSON', () => {
    readFileSyncStub.returns('invalid json {')

    expect(() => parseCursorConversation('invalid.json')).to.throw('Invalid JSON format')
  })

  it('should throw error if messages array is missing', () => {

    const mockConversation = {
      id: 'no-messages',
      timestamp: 1_762_411_514_109,
      title: 'No Messages',
      type: 'Cursor',
    }

    readFileSyncStub.returns(JSON.stringify(mockConversation))

    expect(() => parseCursorConversation('test.json')).to.throw('missing or invalid "messages" array')
  })

  it('should throw error if conversation has no messages', () => {

    const mockConversation = {
      id: 'empty-messages',
      messages: [],
      timestamp: 1_762_411_514_109,
      title: 'Empty',
      type: 'Cursor',
    }

    readFileSyncStub.returns(JSON.stringify(mockConversation))

    expect(() => parseCursorConversation('test.json')).to.throw('Conversation has no messages')
  })

  it('should throw error if no user messages found', () => {

    const mockConversation = {
      id: 'no-user',
      messages: [
        {
          content: [{text: 'Only assistant', type: 'text'}],
          timestamp: '2025-11-07T00:24:06.989Z',
          turn_id: 1,
          type: 'assistant',
        },
      ],
      timestamp: 1_762_411_514_109,
      title: 'No User',
      type: 'Cursor',
    }

    readFileSyncStub.returns(JSON.stringify(mockConversation))

    expect(() => parseCursorConversation('test.json')).to.throw('No user messages found')
  })

  it('should handle multiple content blocks in a single message', () => {

    const mockConversation = {
      id: 'multi-content',
      messages: [
        {
          content: [
            {text: 'First part', type: 'text'},
            {text: 'Second part', type: 'text'},
          ],
          timestamp: '2025-11-07T00:24:05.989Z',
          turn_id: 1,
          type: 'user',
        },
      ],
      timestamp: 1_762_411_514_109,
      title: 'Multi Content',
      type: 'Cursor',
    }

    readFileSyncStub.returns(JSON.stringify(mockConversation))

    const result = parseCursorConversation('test.json')

    // Should create separate messages for each content block
    expect(result.history).to.have.lengthOf(2)
    expect(result.history[0].content).to.equal('First part')
    expect(result.history[1].content).to.equal('Second part')
    expect(result.currentPrompt).to.equal('Second part')
  })

  it('should handle tool calls without output', () => {

    const mockConversation = {
      id: 'tool-no-output',
      messages: [
        {
          content: [{text: 'Use tool', type: 'text'}],
          timestamp: '2025-11-07T00:24:05.989Z',
          turn_id: 1,
          type: 'user',
        },
        {
          content: [
            {
              id: 'tool_456',
              input: {arg: 'value'},
              name: 'test_tool',
              type: 'tool_use',
            },
          ],
          timestamp: '2025-11-07T00:24:06.989Z',
          turn_id: 2,
          type: 'assistant',
        },
      ],
      timestamp: 1_762_411_514_109,
      title: 'Tool No Output',
      type: 'Cursor',
    }

    readFileSyncStub.returns(JSON.stringify(mockConversation))

    const result = parseCursorConversation('test.json')

    // Should have user message and assistant tool call, but no tool result
    expect(result.history).to.have.lengthOf(2)
    expect(result.history[1].toolCalls).to.have.lengthOf(1)
  })
})
