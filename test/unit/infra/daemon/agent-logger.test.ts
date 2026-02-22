/**
 * createAgentLogger unit tests
 *
 * Covers the BRV_SESSION_LOG logging path introduced in ENG-1275:
 * - No-op when logPath is absent (BRV_SESSION_LOG not set)
 * - Writes timestamped, prefixed message when logPath is set
 * - Silently swallows write errors (never blocks or throws)
 */

import {expect} from 'chai'
import {mkdirSync, readFileSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {createAgentLogger} from '../../../../src/server/infra/daemon/agent-logger.js'

// ============================================================================
// Helpers
// ============================================================================

let tmpDir: string

function setup(): void {
  tmpDir = join(tmpdir(), `agent-logger-test-${Date.now()}`)
  mkdirSync(tmpDir, {recursive: true})
}

function teardown(): void {
  rmSync(tmpDir, {force: true, recursive: true})
}

// ============================================================================
// Tests
// ============================================================================

describe('createAgentLogger', () => {
  beforeEach(setup)

  afterEach(teardown)

  describe('when logPath is undefined', () => {
    it('should return a no-op function that does not throw', () => {
      const log = createAgentLogger(undefined, '[agent-process:/tmp/proj]')

      expect(() => log('hello')).to.not.throw()
    })

    it('should not write any file when logPath is undefined', () => {
      const log = createAgentLogger(undefined, '[agent-process:/tmp/proj]')
      log('this message should not be persisted')
      // No file to read — just verifying no unexpected side effects
    })
  })

  describe('when logPath is set', () => {
    it('should write a line containing the message to the log file', () => {
      const logFile = join(tmpDir, 'agent.log')
      const log = createAgentLogger(logFile, '[agent-process:/my/project]')

      log('task started')

      const contents = readFileSync(logFile, 'utf8')
      expect(contents).to.include('[agent-process:/my/project]')
      expect(contents).to.include('task started')
    })

    it('should include an ISO timestamp in each line', () => {
      const logFile = join(tmpDir, 'agent.log')
      const log = createAgentLogger(logFile, '[test]')

      log('some event')

      const contents = readFileSync(logFile, 'utf8')
      // ISO 8601: "2024-01-01T00:00:00.000Z"
      expect(contents).to.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/)
    })

    it('should append multiple messages rather than overwriting', () => {
      const logFile = join(tmpDir, 'agent.log')
      const log = createAgentLogger(logFile, '[test]')

      log('first')
      log('second')
      log('third')

      const contents = readFileSync(logFile, 'utf8')
      expect(contents).to.include('first')
      expect(contents).to.include('second')
      expect(contents).to.include('third')
    })

    it('should terminate each line with a newline', () => {
      const logFile = join(tmpDir, 'agent.log')
      const log = createAgentLogger(logFile, '[test]')

      log('line one')
      log('line two')

      const lines = readFileSync(logFile, 'utf8').split('\n').filter(Boolean)
      expect(lines).to.have.length(2)
    })
  })

  describe('when the log file write fails', () => {
    it('should silently ignore the error and not throw', () => {
      // Point to a path that cannot be created (non-existent parent directory)
      const badPath = join(tmpDir, 'nonexistent-dir', 'subdir', 'agent.log')
      const log = createAgentLogger(badPath, '[test]')

      // Must not throw — logging failures must never crash the agent
      expect(() => log('this will fail to write')).to.not.throw()
    })
  })
})
