import type {ConnectionResult, ITransportClient} from '@campfirein/brv-transport-client'
import type {Config} from '@oclif/core'

import {NoInstanceRunningError} from '@campfirein/brv-transport-client'
import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import sinon, {restore, stub} from 'sinon'

import ReviewApprove from '../../src/oclif/commands/review/approve.js'
import ReviewPending from '../../src/oclif/commands/review/pending.js'
import ReviewReject from '../../src/oclif/commands/review/reject.js'
import {ReviewEvents} from '../../src/shared/transport/events/review-events.js'

// ==================== Testable subclasses ====================

class TestableReviewApprove extends ReviewApprove {
  private readonly mockConnector: () => Promise<ConnectionResult>

  constructor(argv: string[], mockConnector: () => Promise<ConnectionResult>, config: Config) {
    super(argv, config)
    this.mockConnector = mockConnector
  }

  protected override getDaemonClientOptions() {
    return {maxRetries: 1, retryDelayMs: 0, transportConnector: this.mockConnector}
  }
}

class TestableReviewPending extends ReviewPending {
  private readonly mockConnector: () => Promise<ConnectionResult>

  constructor(argv: string[], mockConnector: () => Promise<ConnectionResult>, config: Config) {
    super(argv, config)
    this.mockConnector = mockConnector
  }

  protected override getDaemonClientOptions() {
    return {maxRetries: 1, retryDelayMs: 0, transportConnector: this.mockConnector}
  }
}

class TestableReviewReject extends ReviewReject {
  private readonly mockConnector: () => Promise<ConnectionResult>

  constructor(argv: string[], mockConnector: () => Promise<ConnectionResult>, config: Config) {
    super(argv, config)
    this.mockConnector = mockConnector
  }

  protected override getDaemonClientOptions() {
    return {maxRetries: 1, retryDelayMs: 0, transportConnector: this.mockConnector}
  }
}

// ==================== Tests ====================

describe('Review Commands', () => {
  let config: Config
  let loggedMessages: string[]
  let stdoutOutput: string[]
  let mockClient: sinon.SinonStubbedInstance<ITransportClient>
  let mockConnector: sinon.SinonStub<[], Promise<ConnectionResult>>

  before(async () => {
    config = await OclifConfig.load(import.meta.url)
  })

  beforeEach(() => {
    loggedMessages = []
    stdoutOutput = []

    mockClient = {
      connect: stub().resolves(),
      disconnect: stub().resolves(),
      getClientId: stub().returns('test-client-id'),
      getDaemonVersion: stub(),
      getState: stub().returns('connected'),
      isConnected: stub().resolves(true),
      joinRoom: stub().resolves(),
      leaveRoom: stub().resolves(),
      on: stub().returns(() => {}),
      once: stub(),
      onStateChange: stub().returns(() => {}),
      request: stub() as unknown as ITransportClient['request'],
      requestWithAck: stub().resolves(),
    } as unknown as sinon.SinonStubbedInstance<ITransportClient>

    mockConnector = stub<[], Promise<ConnectionResult>>().resolves({
      client: mockClient as unknown as ITransportClient,
      projectRoot: '/test/project',
    })
  })

  afterEach(() => {
    restore()
  })

  function createApproveCommand(...argv: string[]): TestableReviewApprove {
    const command = new TestableReviewApprove(argv, mockConnector, config)
    stub(command, 'log').callsFake((msg?: string) => {
      loggedMessages.push(msg ?? '')
    })
    return command
  }

  function createRejectCommand(...argv: string[]): TestableReviewReject {
    const command = new TestableReviewReject(argv, mockConnector, config)
    stub(command, 'log').callsFake((msg?: string) => {
      loggedMessages.push(msg ?? '')
    })
    return command
  }

  function createJsonApproveCommand(...argv: string[]): TestableReviewApprove {
    const command = new TestableReviewApprove([...argv, '--format', 'json'], mockConnector, config)
    stub(command, 'log').callsFake((msg?: string) => {
      if (msg) loggedMessages.push(msg)
    })
    stub(process.stdout, 'write').callsFake((chunk: string | Uint8Array) => {
      stdoutOutput.push(String(chunk))
      return true
    })
    return command
  }

  function createJsonRejectCommand(...argv: string[]): TestableReviewReject {
    const command = new TestableReviewReject([...argv, '--format', 'json'], mockConnector, config)
    stub(command, 'log').callsFake((msg?: string) => {
      if (msg) loggedMessages.push(msg)
    })
    stub(process.stdout, 'write').callsFake((chunk: string | Uint8Array) => {
      stdoutOutput.push(String(chunk))
      return true
    })
    return command
  }

  function createPendingCommand(): TestableReviewPending {
    const command = new TestableReviewPending([], mockConnector, config)
    stub(command, 'log').callsFake((msg?: string) => {
      loggedMessages.push(msg ?? '')
    })
    return command
  }

  function createJsonPendingCommand(): TestableReviewPending {
    const command = new TestableReviewPending(['--format', 'json'], mockConnector, config)
    stub(command, 'log').callsFake((msg?: string) => {
      loggedMessages.push(msg ?? '')
    })
    stub(process.stdout, 'write').callsFake((chunk: string | Uint8Array) => {
      stdoutOutput.push(String(chunk))
      return true
    })
    return command
  }

  function parseJsonOutput(): {command: string; data: Record<string, unknown>; success: boolean} {
    return JSON.parse(stdoutOutput.join('').trim())
  }

  // ==================== brv review approve ====================

  describe('review approve', () => {
    it('should send review:decideTask with approved decision', async () => {
      ;(mockClient.requestWithAck as sinon.SinonStub).resolves({
        files: [{path: 'auth/jwt.md', reverted: false}],
        totalCount: 1,
      })

      await createApproveCommand('task-abc-123').run()

      const call = (mockClient.requestWithAck as sinon.SinonStub).firstCall
      expect(call.args[0]).to.equal(ReviewEvents.DECIDE_TASK)
      expect(call.args[1]).to.deep.equal({decision: 'approved', taskId: 'task-abc-123'})
    })

    it('should print approved files in text mode', async () => {
      ;(mockClient.requestWithAck as sinon.SinonStub).resolves({
        files: [
          {path: 'auth/jwt.md', reverted: false},
          {path: 'session/guide.md', reverted: false},
        ],
        totalCount: 2,
      })

      await createApproveCommand('task-abc-123').run()

      expect(loggedMessages.some((m) => m.includes('✓ Approved auth/jwt.md'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('✓ Approved session/guide.md'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('2 operations approved'))).to.be.true
    })

    it('should print singular when one operation', async () => {
      ;(mockClient.requestWithAck as sinon.SinonStub).resolves({
        files: [{path: 'auth/jwt.md', reverted: false}],
        totalCount: 1,
      })

      await createApproveCommand('task-abc-123').run()

      expect(loggedMessages.some((m) => m.includes('1 operation approved'))).to.be.true
    })

    it('should print "no pending" message when totalCount is zero', async () => {
      ;(mockClient.requestWithAck as sinon.SinonStub).resolves({files: [], totalCount: 0})

      await createApproveCommand('task-abc-123').run()

      expect(loggedMessages.some((m) => m.includes('No pending operations'))).to.be.true
    })

    it('should output JSON on success', async () => {
      ;(mockClient.requestWithAck as sinon.SinonStub).resolves({
        files: [{path: 'auth/jwt.md', reverted: false}],
        totalCount: 1,
      })

      await createJsonApproveCommand('task-abc-123').run()

      const json = parseJsonOutput()
      expect(json.command).to.equal('review')
      expect(json.success).to.be.true
      expect(json.data).to.have.property('decision', 'approved')
      expect(json.data).to.have.property('taskId', 'task-abc-123')
      expect(json.data).to.have.property('totalCount', 1)
      expect(json.data).to.have.property('files').that.is.an('array').with.lengthOf(1)
    })

    it('should output JSON error on connection failure', async () => {
      mockConnector.rejects(new NoInstanceRunningError())

      await createJsonApproveCommand('task-abc-123').run()

      const json = parseJsonOutput()
      expect(json.success).to.be.false
      expect(json.data).to.have.property('error')
    })

    it('should print error message on connection failure in text mode', async () => {
      mockConnector.rejects(new NoInstanceRunningError())

      await createApproveCommand('task-abc-123').run()

      expect(loggedMessages.some((m) => m.includes('Daemon failed to start automatically'))).to.be.true
    })
  })

  // ==================== brv review reject ====================

  describe('review reject', () => {
    it('should send review:decideTask with rejected decision', async () => {
      ;(mockClient.requestWithAck as sinon.SinonStub).resolves({
        files: [{path: 'auth/jwt.md', reverted: true}],
        totalCount: 1,
      })

      await createRejectCommand('task-abc-123').run()

      const call = (mockClient.requestWithAck as sinon.SinonStub).firstCall
      expect(call.args[0]).to.equal(ReviewEvents.DECIDE_TASK)
      expect(call.args[1]).to.deep.equal({decision: 'rejected', taskId: 'task-abc-123'})
    })

    it('should print rejected files with reverted suffix', async () => {
      ;(mockClient.requestWithAck as sinon.SinonStub).resolves({
        files: [
          {path: 'auth/jwt.md', reverted: true},
          {path: 'session/guide.md', reverted: true},
        ],
        totalCount: 2,
      })

      await createRejectCommand('task-abc-123').run()

      expect(loggedMessages.some((m) => m.includes('✓ Rejected auth/jwt.md (restored from backup)'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('✓ Rejected session/guide.md (restored from backup)'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('2 operations rejected'))).to.be.true
    })

    it('should not add reverted suffix when file was not reverted', async () => {
      ;(mockClient.requestWithAck as sinon.SinonStub).resolves({
        files: [{path: 'auth/jwt.md', reverted: false}],
        totalCount: 1,
      })

      await createRejectCommand('task-abc-123').run()

      const rejectMsg = loggedMessages.find((m) => m.includes('✓ Rejected auth/jwt.md'))
      expect(rejectMsg).to.exist
      expect(rejectMsg).to.not.include('restored from backup')
    })

    it('should print "no pending" message when totalCount is zero', async () => {
      ;(mockClient.requestWithAck as sinon.SinonStub).resolves({files: [], totalCount: 0})

      await createRejectCommand('task-abc-123').run()

      expect(loggedMessages.some((m) => m.includes('No pending operations'))).to.be.true
    })

    it('should output JSON on success', async () => {
      ;(mockClient.requestWithAck as sinon.SinonStub).resolves({
        files: [{path: 'auth/jwt.md', reverted: true}],
        totalCount: 1,
      })

      await createJsonRejectCommand('task-abc-123').run()

      const json = parseJsonOutput()
      expect(json.command).to.equal('review')
      expect(json.success).to.be.true
      expect(json.data).to.have.property('decision', 'rejected')
      expect(json.data).to.have.property('taskId', 'task-abc-123')
      expect(json.data).to.have.property('totalCount', 1)
    })
  })

  // ==================== brv review pending ====================

  describe('review pending', () => {
    it('should send review:pending event', async () => {
      ;(mockClient.requestWithAck as sinon.SinonStub).resolves({pendingCount: 0, tasks: []})

      await createPendingCommand().run()

      const call = (mockClient.requestWithAck as sinon.SinonStub).firstCall
      expect(call.args[0]).to.equal(ReviewEvents.PENDING)
      expect(call.args[1]).to.deep.equal({})
    })

    it('should print "no pending" message when no reviews', async () => {
      ;(mockClient.requestWithAck as sinon.SinonStub).resolves({pendingCount: 0, tasks: []})

      await createPendingCommand().run()

      expect(loggedMessages.some((m) => m.includes('No pending reviews.'))).to.be.true
    })

    it('should print operation details and approve/reject commands', async () => {
      ;(mockClient.requestWithAck as sinon.SinonStub).resolves({
        pendingCount: 1,
        tasks: [
          {
            operations: [
              {
                impact: 'high',
                path: 'infrastructure/caching',
                previousSummary: 'Redis only',
                reason: 'Added Memcached layer',
                summary: 'Redis + Memcached',
                type: 'UPSERT',
              },
            ],
            taskId: 'task-abc-123',
          },
        ],
      })

      await createPendingCommand().run()

      expect(loggedMessages.some((m) => m.includes('1 operation pending review'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('[UPSERT · HIGH IMPACT] - path: infrastructure/caching'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('Added Memcached layer'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('Redis only'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('Redis + Memcached'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('review approve task-abc-123'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('review reject task-abc-123'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('--file <path>'))).to.be.true
    })

    it('should use plural for multiple operations', async () => {
      ;(mockClient.requestWithAck as sinon.SinonStub).resolves({
        pendingCount: 2,
        tasks: [
          {
            operations: [
              {path: 'auth/jwt', type: 'UPSERT'},
              {path: 'auth/session', type: 'DELETE'},
            ],
            taskId: 'task-abc-123',
          },
        ],
      })

      await createPendingCommand().run()

      expect(loggedMessages.some((m) => m.includes('2 operations pending review'))).to.be.true
    })

    it('should omit impact suffix for low-impact operations', async () => {
      ;(mockClient.requestWithAck as sinon.SinonStub).resolves({
        pendingCount: 1,
        tasks: [
          {
            operations: [{impact: 'low', path: 'auth/jwt', type: 'ADD'}],
            taskId: 'task-abc-123',
          },
        ],
      })

      await createPendingCommand().run()

      const opLine = loggedMessages.find((m) => m.includes('[ADD]'))
      expect(opLine).to.exist
      expect(opLine).to.not.include('HIGH IMPACT')
    })

    it('should separate multiple tasks with a --- separator', async () => {
      ;(mockClient.requestWithAck as sinon.SinonStub).resolves({
        pendingCount: 2,
        tasks: [
          {operations: [{path: 'auth/jwt', type: 'UPSERT'}], taskId: 'task-aaa'},
          {operations: [{path: 'infra/cache', type: 'DELETE'}], taskId: 'task-bbb'},
        ],
      })

      await createPendingCommand().run()

      expect(loggedMessages.some((m) => m.includes('review approve task-aaa'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('review approve task-bbb'))).to.be.true
      expect(loggedMessages.includes('---')).to.be.true
    })

    it('should output JSON with tasks and pendingCount', async () => {
      ;(mockClient.requestWithAck as sinon.SinonStub).resolves({
        pendingCount: 1,
        tasks: [
          {
            operations: [{impact: 'high', path: 'infrastructure/caching', type: 'UPSERT'}],
            taskId: 'task-abc-123',
          },
        ],
      })

      await createJsonPendingCommand().run()

      const json = parseJsonOutput()
      expect(json.command).to.equal('review')
      expect(json.success).to.be.true
      expect(json.data).to.have.property('pendingCount', 1)
      expect(json.data).to.have.property('status', 'success')
      const {tasks} = json.data as {tasks: Array<{operations: unknown[]; taskId: string}>}
      expect(tasks).to.be.an('array').with.lengthOf(1)
      const [first] = tasks
      expect(first.taskId).to.equal('task-abc-123')
      expect(first.operations).to.have.lengthOf(1)
    })

    it('should output JSON with empty tasks when no pending reviews', async () => {
      ;(mockClient.requestWithAck as sinon.SinonStub).resolves({pendingCount: 0, tasks: []})

      await createJsonPendingCommand().run()

      const json = parseJsonOutput()
      expect(json.success).to.be.true
      expect(json.data).to.have.property('pendingCount', 0)
      expect(json.data).to.have.property('tasks').that.is.an('array').with.lengthOf(0)
    })

    it('should output JSON error on connection failure', async () => {
      mockConnector.rejects(new NoInstanceRunningError())

      await createJsonPendingCommand().run()

      const json = parseJsonOutput()
      expect(json.success).to.be.false
      expect(json.data).to.have.property('error')
    })

    it('should print error message on connection failure in text mode', async () => {
      mockConnector.rejects(new NoInstanceRunningError())

      await createPendingCommand().run()

      expect(loggedMessages.some((m) => m.includes('Daemon failed to start automatically'))).to.be.true
    })
  })
})
