import {expect} from 'chai'
import {existsSync, mkdirSync, readFileSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {io, Socket} from 'socket.io-client'

import {CoreProcess} from '../../../../src/infra/core/core-process.js'

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
})
