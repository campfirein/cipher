import {expect} from 'chai'
import {existsSync, mkdirSync, readFileSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {io, Socket} from 'socket.io-client'

import type {TaskCallbacks, TaskInput} from '../../../../src/infra/core/task-processor.js'

import {CoreProcess} from '../../../../src/infra/core/core-process.js'

/**
 * Mock TaskProcessor for testing broadcast events
 */
class MockTaskProcessor {
  private mockBehavior: 'error' | 'streaming' | 'success' = 'success'
  private streamChunks: string[] = ['Hello ', 'World', '!']

  cancel(_taskId: string): boolean {
    return true
  }

  isRunning(_taskId: string): boolean {
    return false
  }

  async process(_input: TaskInput, callbacks?: TaskCallbacks): Promise<void> {
    // Simulate async start
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10)
    })

    callbacks?.onStarted?.()

    switch (this.mockBehavior) {
      case 'error': {
        callbacks?.onError?.('Mock error occurred')
        break
      }

      case 'streaming': {
        for (const chunk of this.streamChunks) {
          // eslint-disable-next-line no-await-in-loop
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 5)
          })
          callbacks?.onChunk?.(chunk)
        }

        callbacks?.onToolCall?.({args: {path: '/test'}, callId: 'call-1', name: 'read_file'})
        callbacks?.onToolResult?.({callId: 'call-1', result: 'file content', success: true})
        callbacks?.onCompleted?.('Streaming completed')
        break
      }

      case 'success': {
        callbacks?.onCompleted?.('Task completed successfully')
        break
      }
    }
  }

  setAuthToken(_token: {accessToken: string; sessionKey: string}): void {
    // Mock
  }

  setMockBehavior(behavior: 'error' | 'streaming' | 'success', chunks?: string[]): void {
    this.mockBehavior = behavior
    if (chunks) this.streamChunks = chunks
  }
}

describe('CoreProcess (Integration)', function () {
  this.timeout(10_000) // 10s timeout for integration tests

  let core: CoreProcess
  let tempDir: string
  let client: null | Socket = null

  beforeEach(() => {
    // Create temp directory for each test
    tempDir = join(tmpdir(), `brv-core-test-${Date.now()}`)
    mkdirSync(join(tempDir, '.brv'), {recursive: true})
  })

  afterEach(async () => {
    // Cleanup client
    if (client?.connected) {
      client.disconnect()
    }

    client = null

    // Cleanup core
    if (core?.isRunning()) {
      await core.stop()
    }

    // Cleanup temp directory
    try {
      rmSync(tempDir, {recursive: true})
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('Lifecycle', () => {
    it('should start and write instance.json', async () => {
      core = new CoreProcess({projectRoot: tempDir})
      await core.start()

      // Verify state
      expect(core.isRunning()).to.be.true
      const state = core.getState()
      expect(state.port).to.be.a('number')
      expect(state.running).to.be.true

      // Verify instance.json
      const instancePath = join(tempDir, '.brv', 'instance.json')
      expect(existsSync(instancePath)).to.be.true

      const instance = JSON.parse(readFileSync(instancePath, 'utf8'))
      expect(instance.port).to.equal(state.port)
      expect(instance.pid).to.be.a('number')
      expect(instance.startedAt).to.be.a('number')
    })

    it('should cleanup instance.json on stop', async () => {
      core = new CoreProcess({projectRoot: tempDir})
      await core.start()

      const instancePath = join(tempDir, '.brv', 'instance.json')
      expect(existsSync(instancePath)).to.be.true

      await core.stop()

      expect(existsSync(instancePath)).to.be.false
      expect(core.isRunning()).to.be.false
    })

    it('should throw error if already running', async () => {
      core = new CoreProcess({projectRoot: tempDir})
      await core.start()

      try {
        await core.start()
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.include('already running')
      }
    })
  })

  describe('Transport', () => {
    it('should accept socket.io connections', async () => {
      core = new CoreProcess({projectRoot: tempDir})
      await core.start()

      const state = core.getState()
      client = io(`http://127.0.0.1:${state.port}`, {timeout: 2000})

      await new Promise<void>((resolve, reject) => {
        client!.on('connect', () => resolve())
        client!.on('connect_error', (err) => reject(err))
        setTimeout(() => reject(new Error('Connection timeout')), 3000)
      })

      expect(client.connected).to.be.true
    })
  })

  describe('Task Handlers', () => {
    beforeEach(async () => {
      core = new CoreProcess({projectRoot: tempDir})
      await core.start()

      const state = core.getState()
      client = io(`http://127.0.0.1:${state.port}`, {timeout: 2000})

      await new Promise<void>((resolve, reject) => {
        client!.on('connect', () => resolve())
        client!.on('connect_error', (err) => reject(err))
        setTimeout(() => reject(new Error('Connection timeout')), 3000)
      })
    })

    it('should handle task:create and return taskId', async () => {
      const response = await new Promise<{data: {taskId: string}; success: boolean}>((resolve) => {
        client!.emit('task:create', {input: 'test', type: 'curate'}, resolve)
      })

      expect(response.success).to.be.true
      expect(response.data.taskId).to.be.a('string')
      expect(response.data.taskId.length).to.be.greaterThan(0)
    })

    it('should broadcast task:ack on task:create', async () => {
      const ackPromise = new Promise<{taskId: string}>((resolve) => {
        client!.on('task:ack', resolve)
      })

      client!.emit('task:create', {input: 'test', type: 'curate'}, () => {})

      const ack = await ackPromise
      expect(ack.taskId).to.be.a('string')
    })

    it('should handle task:cancel', async () => {
      const response = await new Promise<{data: {success: boolean}; success: boolean}>((resolve) => {
        client!.emit('task:cancel', {taskId: 'test-task-id'}, resolve)
      })

      expect(response.success).to.be.true
      expect(response.data.success).to.be.true
    })
  })

  describe('Session Handlers', () => {
    beforeEach(async () => {
      core = new CoreProcess({projectRoot: tempDir})
      await core.start()

      const state = core.getState()
      client = io(`http://127.0.0.1:${state.port}`, {timeout: 2000})

      await new Promise<void>((resolve, reject) => {
        client!.on('connect', () => resolve())
        client!.on('connect_error', (err) => reject(err))
        setTimeout(() => reject(new Error('Connection timeout')), 3000)
      })
    })

    it('should handle session:info', async () => {
      const response = await new Promise<{
        data: {session: {id: string}; stats: {totalTasks: number}}
        success: boolean
      }>((resolve) => {
        client!.emit('session:info', {}, resolve)
      })

      expect(response.success).to.be.true
      expect(response.data.session.id).to.be.a('string')
      expect(response.data.stats.totalTasks).to.equal(0)
    })

    it('should handle session:list', async () => {
      const response = await new Promise<{data: {sessions: Array<{id: string}>}; success: boolean}>((resolve) => {
        client!.emit('session:list', {}, resolve)
      })

      expect(response.success).to.be.true
      expect(response.data.sessions).to.be.an('array')
    })

    it('should handle session:create', async () => {
      const response = await new Promise<{data: {sessionId: string}; success: boolean}>((resolve) => {
        client!.emit('session:create', {name: 'Test Session'}, resolve)
      })

      expect(response.success).to.be.true
      expect(response.data.sessionId).to.be.a('string')
    })

    it('should broadcast session:switched on session:create', async () => {
      const switchedPromise = new Promise<{sessionId: string}>((resolve) => {
        client!.on('session:switched', resolve)
      })

      client!.emit('session:create', {}, () => {})

      const switched = await switchedPromise
      expect(switched.sessionId).to.be.a('string')
    })

    it('should handle session:switch', async () => {
      const response = await new Promise<{data: {success: boolean}; success: boolean}>((resolve) => {
        client!.emit('session:switch', {sessionId: 'new-session-id'}, resolve)
      })

      expect(response.success).to.be.true
      expect(response.data.success).to.be.true
    })
  })

  describe('Task Lifecycle Events', () => {
    let mockProcessor: MockTaskProcessor

    beforeEach(async () => {
      mockProcessor = new MockTaskProcessor()
      // @ts-expect-error - Using mock processor for testing
      core = new CoreProcess({projectRoot: tempDir, taskProcessor: mockProcessor})
      await core.start()

      const state = core.getState()
      client = io(`http://127.0.0.1:${state.port}`, {timeout: 2000})

      await new Promise<void>((resolve, reject) => {
        client!.on('connect', () => resolve())
        client!.on('connect_error', (err) => reject(err))
        setTimeout(() => reject(new Error('Connection timeout')), 3000)
      })
    })

    it('should broadcast task:started when task begins', async () => {
      mockProcessor.setMockBehavior('success')

      const startedPromise = new Promise<{taskId: string}>((resolve) => {
        client!.on('task:started', resolve)
      })

      client!.emit('task:create', {input: 'test input', type: 'curate'}, () => {})

      const started = await startedPromise
      expect(started.taskId).to.be.a('string')
    })

    it('should broadcast task:completed when task succeeds', async () => {
      mockProcessor.setMockBehavior('success')

      const completedPromise = new Promise<{result: string; taskId: string}>((resolve) => {
        client!.on('task:completed', resolve)
      })

      client!.emit('task:create', {input: 'test input', type: 'curate'}, () => {})

      const completed = await completedPromise
      expect(completed.taskId).to.be.a('string')
      expect(completed.result).to.equal('Task completed successfully')
    })

    it('should broadcast task:error when task fails', async () => {
      mockProcessor.setMockBehavior('error')

      const errorPromise = new Promise<{error: string; taskId: string}>((resolve) => {
        client!.on('task:error', resolve)
      })

      client!.emit('task:create', {input: 'test input', type: 'curate'}, () => {})

      const error = await errorPromise
      expect(error.taskId).to.be.a('string')
      expect(error.error).to.equal('Mock error occurred')
    })

    it('should broadcast task:chunk for streaming output', async () => {
      mockProcessor.setMockBehavior('streaming', ['chunk1', 'chunk2', 'chunk3'])

      const chunks: string[] = []
      const completedPromise = new Promise<void>((resolve) => {
        client!.on('task:chunk', (data: {content: string}) => {
          chunks.push(data.content)
        })
        client!.on('task:completed', () => resolve())
      })

      client!.emit('task:create', {input: 'test input', type: 'curate'}, () => {})

      await completedPromise
      expect(chunks).to.deep.equal(['chunk1', 'chunk2', 'chunk3'])
    })

    it('should broadcast task:toolCall and task:toolResult', async () => {
      mockProcessor.setMockBehavior('streaming')

      const toolCallPromise = new Promise<{callId: string; name: string; taskId: string}>((resolve) => {
        client!.on('task:toolCall', resolve)
      })

      const toolResultPromise = new Promise<{callId: string; success: boolean; taskId: string}>((resolve) => {
        client!.on('task:toolResult', resolve)
      })

      client!.emit('task:create', {input: 'test input', type: 'curate'}, () => {})

      const toolCall = await toolCallPromise
      expect(toolCall.taskId).to.be.a('string')
      expect(toolCall.name).to.equal('read_file')
      expect(toolCall.callId).to.equal('call-1')

      const toolResult = await toolResultPromise
      expect(toolResult.taskId).to.be.a('string')
      expect(toolResult.callId).to.equal('call-1')
      expect(toolResult.success).to.be.true
    })

    it('should broadcast full task lifecycle in order', async () => {
      mockProcessor.setMockBehavior('streaming', ['Hello'])

      const events: string[] = []
      const completedPromise = new Promise<void>((resolve) => {
        client!.on('task:ack', () => events.push('ack'))
        client!.on('task:started', () => events.push('started'))
        client!.on('task:chunk', () => events.push('chunk'))
        client!.on('task:toolCall', () => events.push('toolCall'))
        client!.on('task:toolResult', () => events.push('toolResult'))
        client!.on('task:completed', () => {
          events.push('completed')
          resolve()
        })
      })

      client!.emit('task:create', {input: 'test input', type: 'curate'}, () => {})

      await completedPromise

      // Verify order: ack -> started -> chunk -> toolCall -> toolResult -> completed
      expect(events[0]).to.equal('ack')
      expect(events[1]).to.equal('started')
      expect(events).to.include('chunk')
      expect(events).to.include('toolCall')
      expect(events).to.include('toolResult')
      expect(events.at(-1)).to.equal('completed')
    })
  })
})
