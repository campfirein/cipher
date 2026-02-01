import {expect} from 'chai'
import {existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createSandbox, type SinonSandbox} from 'sinon'

import {DAEMON_INSTANCE_FILE} from '../../../../src/server/constants.js'
import {GlobalInstanceManager} from '../../../../src/server/infra/daemon/global-instance-manager.js'

describe('GlobalInstanceManager', () => {
  let testDir: string
  let sandbox: SinonSandbox
  let manager: GlobalInstanceManager

  beforeEach(() => {
    testDir = realpathSync(mkdtempSync(join(tmpdir(), 'brv-gim-test-')))
    sandbox = createSandbox()
    manager = new GlobalInstanceManager({dataDir: testDir})
  })

  afterEach(() => {
    sandbox.restore()
    try {
      rmSync(testDir, {force: true, recursive: true})
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('acquire()', () => {
    it('should acquire when no instance.json exists', () => {
      const result = manager.acquire(37_847, '1.6.0')

      expect(result.acquired).to.be.true
      if (result.acquired) {
        expect(result.instance.pid).to.equal(process.pid)
        expect(result.instance.port).to.equal(37_847)
        expect(result.instance.startedAt).to.be.a('number')
      }
    })

    it('should write valid JSON to instance.json', () => {
      manager.acquire(37_847, '1.6.0')

      const filePath = join(testDir, DAEMON_INSTANCE_FILE)
      expect(existsSync(filePath)).to.be.true

      const content = readFileSync(filePath, 'utf8')
      const parsed = JSON.parse(content)
      expect(parsed.pid).to.equal(process.pid)
      expect(parsed.port).to.equal(37_847)
      expect(typeof parsed.startedAt).to.equal('number')
    })

    it('should fail when live PID exists', () => {
      // First acquire succeeds (current process PID is alive)
      const first = manager.acquire(37_847, '1.6.0')
      expect(first.acquired).to.be.true

      // Second acquire fails (same PID is alive)
      const second = manager.acquire(37_848, '1.6.0')
      expect(second.acquired).to.be.false
      if (!second.acquired) {
        expect(second.reason).to.equal('already_running')
        if (second.reason === 'already_running') {
          expect(second.existingInstance.port).to.equal(37_847)
        }
      }
    })

    it('should overwrite stale instance (dead PID)', () => {
      // Write an instance with a dead PID
      const fakePid = 999_999_999 // Almost certainly not running
      const fakeInstance = {pid: fakePid, port: 37_847, startedAt: Date.now() - 60_000, version: '1.5.0'}
      writeFileSync(join(testDir, DAEMON_INSTANCE_FILE), JSON.stringify(fakeInstance, null, 2))

      // Acquire should succeed (dead PID gets overwritten)
      const result = manager.acquire(37_848, '1.6.0')
      expect(result.acquired).to.be.true
      if (result.acquired) {
        expect(result.instance.pid).to.equal(process.pid)
        expect(result.instance.port).to.equal(37_848)
      }
    })

    it('should create parent directory if missing', () => {
      const nestedDir = join(testDir, 'nested', 'dir')
      const nestedManager = new GlobalInstanceManager({dataDir: nestedDir})

      const result = nestedManager.acquire(37_847, '1.6.0')
      expect(result.acquired).to.be.true
      expect(existsSync(join(nestedDir, DAEMON_INSTANCE_FILE))).to.be.true
    })

    it('should not leave temp file after successful acquire', () => {
      manager.acquire(37_847, '1.6.0')

      const files = readdirSync(testDir)
      const tempFiles = files.filter((f) => f.includes('.tmp.'))
      expect(tempFiles).to.have.lengthOf(0)
    })
  })

  describe('load()', () => {
    it('should return undefined when no file exists', () => {
      const result = manager.load()
      expect(result).to.be.undefined
    })

    it('should parse valid instance.json', () => {
      manager.acquire(37_847, '1.6.0')
      const result = manager.load()
      expect(result).to.not.be.undefined
      expect(result!.pid).to.equal(process.pid)
      expect(result!.port).to.equal(37_847)
    })

    it('should return undefined for corrupted JSON', () => {
      writeFileSync(join(testDir, DAEMON_INSTANCE_FILE), 'not valid json{{{')
      const result = manager.load()
      expect(result).to.be.undefined
    })

    it('should return undefined for invalid schema', () => {
      writeFileSync(join(testDir, DAEMON_INSTANCE_FILE), JSON.stringify({foo: 'bar'}))
      const result = manager.load()
      expect(result).to.be.undefined
    })
  })

  describe('release()', () => {
    it('should delete instance.json', () => {
      manager.acquire(37_847, '1.6.0')
      const filePath = join(testDir, DAEMON_INSTANCE_FILE)
      expect(existsSync(filePath)).to.be.true

      manager.release()
      expect(existsSync(filePath)).to.be.false
    })

    it('should not throw when file does not exist', () => {
      expect(() => manager.release()).to.not.throw()
    })

    it('should not delete instance.json owned by another PID', () => {
      const otherPidInstance = {pid: 999_999_999, port: 37_847, startedAt: Date.now(), version: '1.6.0'}
      writeFileSync(join(testDir, DAEMON_INSTANCE_FILE), JSON.stringify(otherPidInstance, null, 2))

      manager.release()
      expect(existsSync(join(testDir, DAEMON_INSTANCE_FILE))).to.be.true
    })
  })
})
