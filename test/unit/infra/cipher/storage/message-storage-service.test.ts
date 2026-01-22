import {expect} from 'chai'

import type {InternalMessage} from '../../../../../src/core/interfaces/cipher/message-types.js'

import {COMPACTED_TOOL_OUTPUT_PLACEHOLDER} from '../../../../../src/core/domain/cipher/storage/message-storage-types.js'
import {MessageStorageService} from '../../../../../src/infra/cipher/storage/message-storage-service.js'
import {SqliteKeyStorage} from '../../../../../src/infra/cipher/storage/sqlite-key-storage.js'

async function createToolMessages(
  storage: MessageStorageService,
  sessionId: string,
  count: number,
  outputSize: number,
): Promise<void> {
  for (let i = 0; i < count; i++) {
    // eslint-disable-next-line no-await-in-loop
    await storage.saveMessage(sessionId, {
      content: 'query',
      role: 'user',
    })
    // eslint-disable-next-line no-await-in-loop
    await storage.saveMessage(sessionId, {
      content: 'x'.repeat(outputSize),
      name: 'tool',
      role: 'tool',
      toolCallId: `call-${i}`,
    })
  }
}

describe('MessageStorageService', () => {
  let storage: MessageStorageService
  let keyStorage: SqliteKeyStorage

  beforeEach(async () => {
    keyStorage = new SqliteKeyStorage({inMemory: true})
    await keyStorage.initialize()
    storage = new MessageStorageService(keyStorage)
  })

  afterEach(() => {
    keyStorage.close()
  })

  describe('session management', () => {
    it('should create session on first message save', async () => {
      const message: InternalMessage = {content: 'Hello', role: 'user'}
      await storage.saveMessage('session-1', message)

      expect(await storage.hasSession('session-1')).to.be.true
    })

    it('should check if session exists with hasSession', async () => {
      expect(await storage.hasSession('nonexistent')).to.be.false

      await storage.saveMessage('exists', {content: 'test', role: 'user'})
      expect(await storage.hasSession('exists')).to.be.true
    })

    it('should get session record with getSession', async () => {
      await storage.saveMessage('get-session', {content: 'test', role: 'user'})

      const session = await storage.getSession('get-session')
      expect(session).to.exist
      expect(session?.sessionId).to.equal('get-session')
      expect(session?.messageCount).to.equal(1)
    })

    it('should list all session IDs', async () => {
      await storage.saveMessage('s1', {content: 'a', role: 'user'})
      await storage.saveMessage('s2', {content: 'b', role: 'user'})

      const sessions = await storage.listSessions()
      expect(sessions).to.include.members(['s1', 's2'])
    })

    it('should delete session and all its messages/parts', async () => {
      await storage.saveMessage('to-delete', {content: 'msg1', role: 'user'})
      await storage.saveMessage('to-delete', {content: 'msg2', role: 'assistant'})

      const deleted = await storage.deleteSession('to-delete')
      expect(deleted).to.be.true
      expect(await storage.hasSession('to-delete')).to.be.false
    })

    it('should return false when deleting non-existent session', async () => {
      const deleted = await storage.deleteSession('nonexistent')
      expect(deleted).to.be.false
    })
  })

  describe('message storage', () => {
    it('should save a simple user message', async () => {
      const message: InternalMessage = {content: 'Hello world', role: 'user'}
      const stored = await storage.saveMessage('session', message)

      expect(stored.role).to.equal('user')
      expect(stored.content).to.equal('Hello world')
      expect(stored.sessionId).to.equal('session')
    })

    it('should save an assistant message with tool calls', async () => {
      const message: InternalMessage = {
        content: null,
        role: 'assistant',
        toolCalls: [
          {
            function: {arguments: '{"path": "test.ts"}', name: 'read_file'},
            id: 'call-1',
            type: 'function',
          },
        ],
      }
      const stored = await storage.saveMessage('session', message)

      expect(stored.role).to.equal('assistant')
      expect(stored.content).to.be.null
      expect(stored.toolCalls).to.have.lengthOf(1)
    })

    it('should save a tool result message', async () => {
      const message: InternalMessage = {
        content: 'File contents here',
        name: 'read_file',
        role: 'tool',
        toolCallId: 'call-1',
      }
      const stored = await storage.saveMessage('session', message)

      expect(stored.role).to.equal('tool')
      expect(stored.partIds).to.have.lengthOf(1) // tool_output part
    })

    it('should maintain linked list pointers', async () => {
      await storage.saveMessage('linked', {content: 'first', role: 'user'})
      await storage.saveMessage('linked', {content: 'second', role: 'assistant'})
      await storage.saveMessage('linked', {content: 'third', role: 'user'})

      const session = await storage.getSession('linked')
      expect(session?.messageCount).to.equal(3)
      expect(session?.oldestMessageId).to.exist
      expect(session?.newestMessageId).to.exist
      expect(session?.oldestMessageId).to.not.equal(session?.newestMessageId)
    })

    it('should increment messageCount on each save', async () => {
      await storage.saveMessage('count', {content: '1', role: 'user'})
      let session = await storage.getSession('count')
      expect(session?.messageCount).to.equal(1)

      await storage.saveMessage('count', {content: '2', role: 'assistant'})
      session = await storage.getSession('count')
      expect(session?.messageCount).to.equal(2)
    })
  })

  describe('message loading', () => {
    it('should load messages in chronological order (oldest first)', async () => {
      await storage.saveMessage('load', {content: 'first', role: 'user'})
      await storage.saveMessage('load', {content: 'second', role: 'assistant'})
      await storage.saveMessage('load', {content: 'third', role: 'user'})

      const result = await storage.loadMessages('load')
      expect(result.messages).to.have.lengthOf(3)
      expect(result.messages[0].content).to.equal('first')
      expect(result.messages[1].content).to.equal('second')
      expect(result.messages[2].content).to.equal('third')
    })

    it('should return empty array for non-existent session', async () => {
      const result = await storage.loadMessages('nonexistent')
      expect(result.messages).to.deep.equal([])
      expect(result.hitCompactionBoundary).to.be.false
    })
  })

  describe('streaming messages', () => {
    it('should yield messages from newest to oldest', async () => {
      await storage.saveMessage('stream', {content: 'first', role: 'user'})
      await storage.saveMessage('stream', {content: 'second', role: 'assistant'})
      await storage.saveMessage('stream', {content: 'third', role: 'user'})

      const messages: string[] = []
      for await (const msg of storage.streamMessages({sessionId: 'stream'})) {
        messages.push(msg.content ?? '')
      }

      expect(messages).to.deep.equal(['third', 'second', 'first'])
    })

    it('should respect limit parameter', async () => {
      await storage.saveMessage('limit', {content: '1', role: 'user'})
      await storage.saveMessage('limit', {content: '2', role: 'assistant'})
      await storage.saveMessage('limit', {content: '3', role: 'user'})

      const messages: string[] = []
      for await (const msg of storage.streamMessages({limit: 2, sessionId: 'limit'})) {
        messages.push(msg.content ?? '')
      }

      expect(messages).to.have.lengthOf(2)
      expect(messages).to.deep.equal(['3', '2'])
    })

    it('should yield nothing for non-existent session', async () => {
      const messages: unknown[] = []
      for await (const msg of storage.streamMessages({sessionId: 'nonexistent'})) {
        messages.push(msg)
      }

      expect(messages).to.have.lengthOf(0)
    })
  })

  describe('compaction boundaries', () => {
    it('should insert compaction boundary with summary', async () => {
      await storage.saveMessage('compact', {content: 'message', role: 'user'})
      const boundary = await storage.insertCompactionBoundary('compact', 'Summary of previous messages')

      expect(boundary.compactionBoundary).to.be.true
      expect(boundary.compactionSummary).to.equal('Summary of previous messages')
    })

    it('should update session lastCompactionMessageId', async () => {
      await storage.saveMessage('compact-id', {content: 'msg', role: 'user'})
      const boundary = await storage.insertCompactionBoundary('compact-id', 'Summary')

      const session = await storage.getSession('compact-id')
      expect(session?.lastCompactionMessageId).to.equal(boundary.id)
    })

    it('should stop loading at compaction boundary when stopAtCompaction=true', async () => {
      await storage.saveMessage('stop', {content: 'old1', role: 'user'})
      await storage.saveMessage('stop', {content: 'old2', role: 'assistant'})
      await storage.insertCompactionBoundary('stop', 'Summary')
      await storage.saveMessage('stop', {content: 'new1', role: 'user'})
      await storage.saveMessage('stop', {content: 'new2', role: 'assistant'})

      const result = await storage.loadMessages('stop', {stopAtCompaction: true})

      expect(result.hitCompactionBoundary).to.be.true
      // Should include boundary message + messages after it
      const contents = result.messages.map((m) => m.content ?? m.compactionSummary)
      expect(contents).to.include('Summary')
      expect(contents).to.include('new1')
      expect(contents).to.include('new2')
      expect(contents).to.not.include('old1')
      expect(contents).to.not.include('old2')
    })

    it('should load full history when stopAtCompaction=false', async () => {
      await storage.saveMessage('full', {content: 'old', role: 'user'})
      await storage.insertCompactionBoundary('full', 'Summary')
      await storage.saveMessage('full', {content: 'new', role: 'user'})

      const result = await storage.loadMessages('full', {stopAtCompaction: false})
      const contents = result.messages.map((m) => m.content ?? '')
      expect(contents).to.include('old')
      expect(contents).to.include('new')
    })
  })

  describe('tool output pruning', () => {
    it('should prune old tool outputs beyond keepTokens', async () => {
      // Create 10 tool outputs, each ~1000 chars (~250 tokens each)
      await createToolMessages(storage, 'prune', 10, 1000)

      const result = await storage.pruneToolOutputs({
        keepTokens: 500, // Keep ~500 tokens worth
        minimumTokens: 100, // Low threshold for test
        protectedTurns: 0, // No protected turns
        sessionId: 'prune',
      })

      expect(result.compactedCount).to.be.greaterThan(0)
      expect(result.tokensSaved).to.be.greaterThan(0)
    })

    it('should protect recent user turns', async () => {
      await createToolMessages(storage, 'protect', 5, 1000)

      const result = await storage.pruneToolOutputs({
        keepTokens: 0, // Would prune everything if not for protection
        minimumTokens: 100,
        protectedTurns: 5, // Protect all 5 turns
        sessionId: 'protect',
      })

      // Everything is protected, nothing should be compacted
      expect(result.compactedCount).to.equal(0)
    })

    it('should skip pruning if savings below minimumTokens', async () => {
      await storage.saveMessage('min-threshold', {
        content: 'short output',
        name: 'tool',
        role: 'tool',
        toolCallId: 'call-1',
      })

      const result = await storage.pruneToolOutputs({
        keepTokens: 0,
        minimumTokens: 100_000, // Very high threshold
        protectedTurns: 0,
        sessionId: 'min-threshold',
      })

      expect(result.compactedCount).to.equal(0)
    })

    it('should return zero for non-existent session', async () => {
      const result = await storage.pruneToolOutputs({
        sessionId: 'nonexistent',
      })

      expect(result.compactedCount).to.equal(0)
      expect(result.tokensSaved).to.equal(0)
    })
  })

  describe('tool part state machine', () => {
    it('should create tool part in pending state', async () => {
      await storage.saveMessage('tool-state', {content: null, role: 'assistant'})
      const session = await storage.getSession('tool-state')
      const newestMsgId = session?.newestMessageId ?? ''

      const toolPart = await storage.createToolPart({
        callId: 'call-123',
        input: {path: 'test.ts'},
        messageId: newestMsgId,
        sessionId: 'tool-state',
        toolName: 'read_file',
      })

      expect(toolPart.type).to.equal('tool')
      expect(toolPart.toolState?.status).to.equal('pending')
      expect(toolPart.toolState?.callId).to.equal('call-123')
    })

    it('should update tool part state', async () => {
      await storage.saveMessage('update-state', {content: null, role: 'assistant'})
      const session = await storage.getSession('update-state')
      const newestMsgId = session?.newestMessageId ?? ''

      const toolPart = await storage.createToolPart({
        callId: 'call-update',
        input: {},
        messageId: newestMsgId,
        sessionId: 'update-state',
        toolName: 'test_tool',
      })

      await storage.updateToolPartState(newestMsgId, toolPart.id, {
        completedAt: Date.now(),
        output: 'Tool output',
        startedAt: Date.now() - 100,
        status: 'completed',
      })

      const updated = await storage.getToolPartByCallId(newestMsgId, 'call-update')
      expect(updated?.toolState?.status).to.equal('completed')
      expect(updated?.toolState?.output).to.equal('Tool output')
    })

    it('should get tool part by callId', async () => {
      await storage.saveMessage('get-by-call', {content: null, role: 'assistant'})
      const session = await storage.getSession('get-by-call')
      const msgId = session?.newestMessageId ?? ''

      await storage.createToolPart({
        callId: 'find-me',
        input: {},
        messageId: msgId,
        sessionId: 'get-by-call',
        toolName: 'tool',
      })

      const found = await storage.getToolPartByCallId(msgId, 'find-me')
      expect(found).to.exist
      expect(found?.toolState?.callId).to.equal('find-me')
    })

    it('should return undefined for non-existent callId', async () => {
      await storage.saveMessage('no-call', {content: null, role: 'assistant'})
      const session = await storage.getSession('no-call')
      const msgId = session?.newestMessageId ?? ''

      const found = await storage.getToolPartByCallId(msgId, 'nonexistent')
      expect(found).to.be.undefined
    })
  })

  describe('InternalMessage conversion', () => {
    it('should convert StoredMessageWithParts to InternalMessage', async () => {
      await storage.saveMessage('convert', {content: 'Hello', role: 'user'})
      const result = await storage.loadMessages('convert')
      const internal = storage.toInternalMessages(result.messages)

      expect(internal).to.have.lengthOf(1)
      expect(internal[0].role).to.equal('user')
      expect(internal[0].content).to.equal('Hello')
    })

    it('should preserve message metadata', async () => {
      const original: InternalMessage = {
        content: 'Assistant response',
        reasoning: 'Deep thought',
        role: 'assistant',
        thought: 'Thinking...',
        thoughtSummary: {description: 'Detailed description', subject: 'Topic'},
      }
      await storage.saveMessage('metadata', original)

      const result = await storage.loadMessages('metadata')
      const internal = storage.toInternalMessages(result.messages)

      expect(internal[0].reasoning).to.equal('Deep thought')
      expect(internal[0].thought).to.equal('Thinking...')
      expect(internal[0].thoughtSummary).to.deep.equal({description: 'Detailed description', subject: 'Topic'})
    })

    it('should handle compacted parts with placeholder', async () => {
      // Create multiple tool outputs to ensure we exceed minimumTokens threshold
      // Each output ~50k tokens, need to exceed 20k minimum tokens saved
      await storage.saveMessage('compacted', {content: 'Start', role: 'user'})

      // Create multiple tool outputs
      for (let i = 0; i < 3; i++) {
        // eslint-disable-next-line no-await-in-loop
        await storage.saveMessage('compacted', {
          content: 'x'.repeat(100_000), // ~25k tokens each
          name: 'tool',
          role: 'tool',
          toolCallId: `call-${i}`,
        })
      }

      // Add user turns to push tool outputs out of protection
      await storage.saveMessage('compacted', {content: 'Continue 1', role: 'user'})
      await storage.saveMessage('compacted', {content: 'Continue 2', role: 'user'})

      const pruneResult = await storage.pruneToolOutputs({
        keepTokens: 10_000, // Keep first 10k tokens
        minimumTokens: 20_000, // Need at least 20k tokens saved
        protectedTurns: 1, // Only protect most recent turn
        sessionId: 'compacted',
      })

      // Verify pruning happened (should have compacted at least some outputs)
      expect(pruneResult.compactedCount).to.be.greaterThan(0)
      expect(pruneResult.tokensSaved).to.be.greaterThanOrEqual(20_000)

      // Reload and convert to verify placeholder is used
      const result = await storage.loadMessages('compacted')
      const toolMessages = result.messages.filter((m) => m.role === 'tool')

      // At least one tool message should have been compacted
      const internal = storage.toInternalMessages(toolMessages)
      const hasPlaceholder = internal.some((m) => m.content === COMPACTED_TOOL_OUTPUT_PLACEHOLDER)
      expect(hasPlaceholder).to.be.true
    })
  })
})
