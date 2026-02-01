import {expect} from 'chai'
import {existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {SpawnLock} from '../../../../src/server/infra/daemon/spawn-lock.js'

describe('SpawnLock', () => {
  let testDir: string

  beforeEach(() => {
    testDir = realpathSync(mkdtempSync(join(tmpdir(), 'brv-spawn-lock-test-')))
  })

  afterEach(() => {
    try {
      rmSync(testDir, {force: true, recursive: true})
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('acquire()', () => {
    it('should acquire when no lock file exists', () => {
      const lock = new SpawnLock({dataDir: testDir})
      const result = lock.acquire()

      expect(result.acquired).to.be.true
      expect(existsSync(join(testDir, 'spawn.lock'))).to.be.true
    })

    it('should write valid JSON to lock file', () => {
      const lock = new SpawnLock({dataDir: testDir})
      lock.acquire()

      const content = readFileSync(join(testDir, 'spawn.lock'), 'utf8')
      const parsed = JSON.parse(content)
      expect(parsed.pid).to.equal(process.pid)
      expect(typeof parsed.timestamp).to.equal('number')
      expect(Date.now() - parsed.timestamp).to.be.lessThan(1000)

      lock.release()
    })

    it('should fail when lock is held by alive process', () => {
      // Write a lock with current PID (alive) and fresh timestamp
      writeFileSync(
        join(testDir, 'spawn.lock'),
        JSON.stringify({pid: process.pid, timestamp: Date.now()}),
      )

      const lock = new SpawnLock({dataDir: testDir})
      const result = lock.acquire()

      expect(result.acquired).to.be.false
      if (!result.acquired) {
        expect(result.reason).to.equal('held_by_another_process')
      }
    })

    it('should overwrite stale lock (dead PID)', () => {
      const deadPid = 999_999_999
      writeFileSync(
        join(testDir, 'spawn.lock'),
        JSON.stringify({pid: deadPid, timestamp: Date.now()}),
      )

      const lock = new SpawnLock({dataDir: testDir})
      const result = lock.acquire()

      expect(result.acquired).to.be.true

      // Verify new lock has our PID
      const content = readFileSync(join(testDir, 'spawn.lock'), 'utf8')
      const parsed = JSON.parse(content)
      expect(parsed.pid).to.equal(process.pid)

      lock.release()
    })

    it('should overwrite stale lock (timestamp >30s)', () => {
      writeFileSync(
        join(testDir, 'spawn.lock'),
        JSON.stringify({pid: process.pid, timestamp: Date.now() - 31_000}),
      )

      const lock = new SpawnLock({dataDir: testDir})
      const result = lock.acquire()

      expect(result.acquired).to.be.true
      lock.release()
    })

    it('should overwrite corrupted lock file', () => {
      writeFileSync(join(testDir, 'spawn.lock'), 'not valid json{{{')

      const lock = new SpawnLock({dataDir: testDir})
      const result = lock.acquire()

      expect(result.acquired).to.be.true
      lock.release()
    })

    it('should overwrite lock with invalid schema', () => {
      writeFileSync(join(testDir, 'spawn.lock'), JSON.stringify({foo: 'bar'}))

      const lock = new SpawnLock({dataDir: testDir})
      const result = lock.acquire()

      expect(result.acquired).to.be.true
      lock.release()
    })

    it('should not leave temp files after successful acquire', () => {
      const lock = new SpawnLock({dataDir: testDir})
      lock.acquire()

      const files = readdirSync(testDir)
      const tempFiles = files.filter((f) => f.includes('.tmp'))
      expect(tempFiles).to.have.lengthOf(0)

      lock.release()
    })
  })

  describe('release()', () => {
    it('should delete lock file', () => {
      const lock = new SpawnLock({dataDir: testDir})
      lock.acquire()
      expect(existsSync(join(testDir, 'spawn.lock'))).to.be.true

      lock.release()
      expect(existsSync(join(testDir, 'spawn.lock'))).to.be.false
    })

    it('should be idempotent', () => {
      const lock = new SpawnLock({dataDir: testDir})
      lock.acquire()
      lock.release()
      lock.release() // Should not throw
    })

    it('should not throw when not acquired', () => {
      const lock = new SpawnLock({dataDir: testDir})
      expect(() => lock.release()).to.not.throw()
    })
  })
})
