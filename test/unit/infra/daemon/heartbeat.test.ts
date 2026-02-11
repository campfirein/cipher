import {expect} from 'chai'
import {existsSync, mkdtempSync, readFileSync, realpathSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createSandbox, type SinonSandbox} from 'sinon'

import {HeartbeatWriter} from '../../../../src/server/infra/daemon/heartbeat.js'

describe('heartbeat', () => {
  let testDir: string
  let sandbox: SinonSandbox

  beforeEach(() => {
    testDir = realpathSync(mkdtempSync(join(tmpdir(), 'brv-heartbeat-test-')))
    sandbox = createSandbox()
  })

  afterEach(() => {
    sandbox.restore()
    try {
      rmSync(testDir, {force: true, recursive: true})
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('createHeartbeatWriter()', () => {
    it('should write heartbeat file immediately on start', () => {
      const filePath = join(testDir, 'heartbeat')
      const logStub = sandbox.stub()
      const writer = new HeartbeatWriter({filePath, intervalMs: 60_000, log: logStub})

      writer.start()
      try {
        expect(existsSync(filePath)).to.be.true
        const content = readFileSync(filePath, 'utf8')
        const timestamp = Number(content)
        expect(Number.isNaN(timestamp)).to.be.false
        expect(Date.now() - timestamp).to.be.lessThan(1000)
      } finally {
        writer.stop()
      }
    })

    it('should not double-start', () => {
      const filePath = join(testDir, 'heartbeat')
      const logStub = sandbox.stub()
      const writer = new HeartbeatWriter({filePath, intervalMs: 60_000, log: logStub})

      writer.start()
      writer.start() // second start should be no-op
      try {
        // Log called once for "Heartbeat started", not twice
        const startCalls = logStub.getCalls().filter((c) => c.args[0] === 'Heartbeat started')
        expect(startCalls.length).to.equal(1)
      } finally {
        writer.stop()
      }
    })

    it('should NOT delete heartbeat file on stop (prevents cascade kill)', () => {
      const filePath = join(testDir, 'heartbeat')
      const logStub = sandbox.stub()
      const writer = new HeartbeatWriter({filePath, intervalMs: 60_000, log: logStub})

      writer.start()
      expect(existsSync(filePath)).to.be.true

      writer.stop()
      // File intentionally left — becomes stale naturally (>15s without writes).
      // Deleting could remove a NEW daemon's heartbeat during overlapping shutdown/startup.
      expect(existsSync(filePath)).to.be.true
    })

    it('should be idempotent on stop', () => {
      const filePath = join(testDir, 'heartbeat')
      const logStub = sandbox.stub()
      const writer = new HeartbeatWriter({filePath, intervalMs: 60_000, log: logStub})

      writer.start()
      writer.stop()
      writer.stop() // should not throw
    })

    it('should write immediately on refresh when running', () => {
      const filePath = join(testDir, 'heartbeat')
      const logStub = sandbox.stub()
      const writer = new HeartbeatWriter({filePath, intervalMs: 60_000, log: logStub})

      writer.start()
      try {
        // Delete file to verify refresh recreates it
        rmSync(filePath, {force: true})
        expect(existsSync(filePath)).to.be.false

        writer.refresh()
        expect(existsSync(filePath)).to.be.true
        const content = readFileSync(filePath, 'utf8')
        const timestamp = Number(content)
        expect(Number.isNaN(timestamp)).to.be.false
      } finally {
        writer.stop()
      }
    })

    it('should not write on refresh when stopped', () => {
      const filePath = join(testDir, 'heartbeat')
      const logStub = sandbox.stub()
      const writer = new HeartbeatWriter({filePath, intervalMs: 60_000, log: logStub})

      // refresh without start should be a no-op
      writer.refresh()
      expect(existsSync(filePath)).to.be.false
    })

    it('should create parent directory if missing', () => {
      const filePath = join(testDir, 'subdir', 'nested', 'heartbeat')
      const logStub = sandbox.stub()
      const writer = new HeartbeatWriter({filePath, intervalMs: 60_000, log: logStub})

      writer.start()
      try {
        expect(existsSync(filePath)).to.be.true
      } finally {
        writer.stop()
      }
    })

    it('should update heartbeat on interval', () => {
      const clock = sandbox.useFakeTimers(Date.now())
      const filePath = join(testDir, 'heartbeat')
      const logStub = sandbox.stub()
      const writer = new HeartbeatWriter({filePath, intervalMs: 50, log: logStub})

      writer.start()
      const initial = readFileSync(filePath, 'utf8')

      // Advance past one interval
      clock.tick(50)

      const updated = readFileSync(filePath, 'utf8')
      writer.stop()

      // Timestamps should differ (fake clock advanced by 50ms)
      expect(Number(updated)).to.be.greaterThan(Number(initial))
    })
  })

  // isHeartbeatStale() tests moved to @campfirein/brv-transport-client
})
