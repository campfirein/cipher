import {expect} from 'chai'

import type {StoredTask, ToolCallEvent} from '../../../../../../src/webui/features/tasks/types/stored-task.js'

import {
  addReasoningContentTo,
  addToolCallTo,
  appendStreamingContentTo,
  updateToolCallResultIn,
} from '../../../../../../src/webui/features/tasks/utils/task-events.js'

const baseTask = (overrides: Partial<StoredTask> = {}): StoredTask => ({
  content: 'do thing',
  createdAt: 1000,
  status: 'started',
  taskId: 'a',
  type: 'curate',
  ...overrides,
})

const toolCall = (overrides: Partial<ToolCallEvent> & {sessionId: string; toolName: string}): ToolCallEvent => ({
  args: {},
  status: 'running',
  timestamp: 2000,
  ...overrides,
})

describe('task-event helpers', () => {
  describe('addToolCallTo', () => {
    it('appends to an empty toolCalls list', () => {
      const task = baseTask()
      const next = addToolCallTo(task, toolCall({callId: 'c1', sessionId: 's1', toolName: 'read'}))
      expect(next.toolCalls).to.have.lengthOf(1)
      expect(next.toolCalls![0].toolName).to.equal('read')
    })

    it('deduplicates by callId — second add updates args + sessionId', () => {
      const task = baseTask({
        toolCalls: [toolCall({args: {}, callId: 'c1', sessionId: 's1', toolName: 'read'})],
      })
      const next = addToolCallTo(
        task,
        toolCall({args: {path: 'x.ts'}, callId: 'c1', sessionId: 's2', toolName: 'read'}),
      )
      expect(next.toolCalls).to.have.lengthOf(1)
      expect(next.toolCalls![0].args).to.deep.equal({path: 'x.ts'})
      expect(next.toolCalls![0].sessionId).to.equal('s2')
    })

    it('preserves existing args when incoming args are empty (avoids clobbering early metadata)', () => {
      const task = baseTask({
        toolCalls: [toolCall({args: {path: 'a.ts'}, callId: 'c1', sessionId: 's1', toolName: 'read'})],
      })
      const next = addToolCallTo(
        task,
        toolCall({args: {}, callId: 'c1', sessionId: 's1', toolName: 'read'}),
      )
      expect(next.toolCalls![0].args).to.deep.equal({path: 'a.ts'})
    })

    it('appends a new entry when callId differs', () => {
      const task = baseTask({
        toolCalls: [toolCall({callId: 'c1', sessionId: 's1', toolName: 'read'})],
      })
      const next = addToolCallTo(
        task,
        toolCall({callId: 'c2', sessionId: 's1', toolName: 'edit'}),
      )
      expect(next.toolCalls).to.have.lengthOf(2)
    })
  })

  describe('updateToolCallResultIn', () => {
    it('marks the matching call completed when success', () => {
      const task = baseTask({
        toolCalls: [toolCall({callId: 'c1', sessionId: 's1', toolName: 'read'})],
      })
      const next = updateToolCallResultIn(task, {
        callId: 'c1',
        result: 'ok',
        success: true,
        toolName: 'read',
      })
      expect(next.toolCalls![0].status).to.equal('completed')
      expect(next.toolCalls![0].result).to.equal('ok')
    })

    it('marks the matching call error when not success', () => {
      const task = baseTask({
        toolCalls: [toolCall({callId: 'c1', sessionId: 's1', toolName: 'read'})],
      })
      const next = updateToolCallResultIn(task, {
        callId: 'c1',
        error: 'boom',
        errorType: 'TimeoutError',
        success: false,
        toolName: 'read',
      })
      expect(next.toolCalls![0].status).to.equal('error')
      expect(next.toolCalls![0].error).to.equal('boom')
      expect(next.toolCalls![0].errorType).to.equal('TimeoutError')
    })

    it('falls back to last running call by toolName when callId is missing', () => {
      const task = baseTask({
        toolCalls: [
          toolCall({callId: 'c0', sessionId: 's1', status: 'completed', toolName: 'bash'}),
          toolCall({callId: 'c1', sessionId: 's1', toolName: 'bash'}),
        ],
      })
      const next = updateToolCallResultIn(task, {
        callId: undefined,
        result: 'ok',
        success: true,
        toolName: 'bash',
      })
      expect(next.toolCalls![0].status).to.equal('completed')
      expect(next.toolCalls![1].status).to.equal('completed')
    })

    it('returns the same task when no match is found', () => {
      const task = baseTask({
        toolCalls: [toolCall({callId: 'c1', sessionId: 's1', toolName: 'read'})],
      })
      const next = updateToolCallResultIn(task, {
        callId: 'unknown',
        result: 'ok',
        success: true,
        toolName: 'unknown',
      })
      expect(next).to.equal(task)
    })
  })

  describe('addReasoningContentTo', () => {
    it('appends a reasoning item to an empty list', () => {
      const task = baseTask()
      const next = addReasoningContentTo(task, {content: 'hello', timestamp: 3000})
      expect(next.reasoningContents).to.have.lengthOf(1)
      expect(next.reasoningContents![0].content).to.equal('hello')
    })

    it('skips a thinking placeholder if last item is also thinking', () => {
      const task = baseTask({
        reasoningContents: [{content: '', isThinking: true, timestamp: 1500}],
      })
      const next = addReasoningContentTo(task, {content: '', isThinking: true, timestamp: 2000})
      expect(next.reasoningContents).to.have.lengthOf(1)
      expect(next.reasoningContents![0].timestamp).to.equal(1500)
    })
  })

  describe('appendStreamingContentTo', () => {
    it('appends to streamingContent for type=text', () => {
      const task = baseTask()
      const next = appendStreamingContentTo(task, {
        content: 'hello',
        isComplete: false,
        type: 'text',
      })
      expect(next.streamingContent).to.equal('hello')
      expect(next.isStreaming).to.be.true
    })

    it('concatenates successive text chunks', () => {
      const task = baseTask({streamingContent: 'hello '})
      const next = appendStreamingContentTo(task, {
        content: 'world',
        isComplete: false,
        type: 'text',
      })
      expect(next.streamingContent).to.equal('hello world')
    })

    it('marks streaming false when isComplete', () => {
      const task = baseTask({streamingContent: 'hello'})
      const next = appendStreamingContentTo(task, {
        content: '!',
        isComplete: true,
        type: 'text',
      })
      expect(next.streamingContent).to.equal('hello!')
      expect(next.isStreaming).to.be.false
    })

    it('appends to last reasoning item when type=reasoning and a placeholder exists', () => {
      const task = baseTask({
        reasoningContents: [{content: '', isThinking: true, timestamp: 1500}],
      })
      const next = appendStreamingContentTo(task, {
        content: 'thinking text',
        isComplete: false,
        type: 'reasoning',
      })
      expect(next.reasoningContents).to.have.lengthOf(1)
      expect(next.reasoningContents![0].content).to.equal('thinking text')
      expect(next.reasoningContents![0].isThinking).to.be.false
    })

    it('creates a reasoning item when no placeholder exists', () => {
      const task = baseTask()
      const next = appendStreamingContentTo(task, {
        content: 'thinking text',
        isComplete: false,
        type: 'reasoning',
      })
      expect(next.reasoningContents).to.have.lengthOf(1)
      expect(next.reasoningContents![0].content).to.equal('thinking text')
    })
  })
})

