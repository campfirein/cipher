import {expect} from 'chai'
import {access, mkdir, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {BRV_DIR} from '../../../../src/server/constants.js'
import {FileInstanceManager} from '../../../../src/server/infra/instance/file-instance-manager.js'

describe('FileInstanceManager', () => {
  let testDir: string
  let manager: FileInstanceManager

  beforeEach(async () => {
    // Create a unique temp directory for each test
    testDir = join(tmpdir(), `brv-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(testDir, {recursive: true})
    manager = new FileInstanceManager()
  })

  afterEach(async () => {
    // Clean up temp directory
    try {
      await rm(testDir, {force: true, recursive: true})
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('acquire', () => {
    it('should acquire lock when no instance exists', async () => {
      const result = await manager.acquire(testDir, 9847)

      expect(result.acquired).to.be.true
      if (result.acquired) {
        expect(result.instance.port).to.equal(9847)
        expect(result.instance.pid).to.equal(process.pid)
        expect(result.instance.currentSessionId).to.be.null
      }
    })

    it('should create .brv directory if it does not exist', async () => {
      await manager.acquire(testDir, 9847)

      const instancePath = join(testDir, BRV_DIR, 'instance.json')
      const content = await readFile(instancePath, 'utf8')
      const json = JSON.parse(content)

      expect(json.port).to.equal(9847)
      expect(json.pid).to.equal(process.pid)
      expect(json).to.have.property('startedAt').that.is.a('number')
    })

    it('should fail to acquire when instance is already running', async () => {
      // First acquire
      const result1 = await manager.acquire(testDir, 9847)
      expect(result1.acquired).to.be.true

      // Second acquire should fail (same process, so PID is alive)
      const result2 = await manager.acquire(testDir, 9999)

      expect(result2.acquired).to.be.false
      if (!result2.acquired) {
        expect(result2.reason).to.equal('already_running')
        expect(result2.existingInstance.port).to.equal(9847)
      }
    })

    it('should acquire when existing instance file is deleted (released)', async () => {
      // First acquire and release
      await manager.acquire(testDir, 9847)
      await manager.release(testDir)

      // Second acquire should succeed
      const result = await manager.acquire(testDir, 9999)

      expect(result.acquired).to.be.true
      if (result.acquired) {
        expect(result.instance.port).to.equal(9999)
      }
    })

    it('should acquire when existing instance has dead PID (crashed)', async () => {
      // Create .brv directory and write instance.json with dead PID
      const brvDir = join(testDir, BRV_DIR)
      await mkdir(brvDir, {recursive: true})
      await writeFile(
        join(brvDir, 'instance.json'),
        JSON.stringify({
          currentSessionId: null,
          pid: 9_999_999, // Non-existent PID
          port: 9847,
          startedAt: Date.now(),
        }),
      )

      // Acquire should succeed (dead PID = stale instance)
      const result = await manager.acquire(testDir, 9999)

      expect(result.acquired).to.be.true
      if (result.acquired) {
        expect(result.instance.port).to.equal(9999)
      }
    })
  })

  describe('load', () => {
    it('should return undefined when no instance.json exists', async () => {
      const instance = await manager.load(testDir)

      expect(instance).to.be.undefined
    })

    it('should load instance info from instance.json', async () => {
      await manager.acquire(testDir, 9847)

      const instance = await manager.load(testDir)

      expect(instance).to.not.be.undefined
      expect(instance?.port).to.equal(9847)
    })

    it('should return undefined for corrupted JSON', async () => {
      // Create .brv directory and write invalid JSON
      const brvDir = join(testDir, BRV_DIR)
      await mkdir(brvDir, {recursive: true})
      await writeFile(join(brvDir, 'instance.json'), 'not valid json {{{')

      const instance = await manager.load(testDir)

      expect(instance).to.be.undefined
    })

    it('should return undefined for invalid schema (missing required fields)', async () => {
      // Create .brv directory and write JSON with missing fields
      const brvDir = join(testDir, BRV_DIR)
      await mkdir(brvDir, {recursive: true})
      await writeFile(join(brvDir, 'instance.json'), JSON.stringify({port: 9847}))

      const instance = await manager.load(testDir)

      expect(instance).to.be.undefined
    })

    it('should return undefined for invalid schema (wrong types)', async () => {
      // Create .brv directory and write JSON with wrong types
      const brvDir = join(testDir, BRV_DIR)
      await mkdir(brvDir, {recursive: true})
      await writeFile(
        join(brvDir, 'instance.json'),
        JSON.stringify({
          currentSessionId: null,
          pid: 'not-a-number', // Should be number
          port: 9847,
          startedAt: Date.now(),
        }),
      )

      const instance = await manager.load(testDir)

      expect(instance).to.be.undefined
    })
  })

  describe('release', () => {
    it('should delete instance.json file', async () => {
      await manager.acquire(testDir, 9847)
      await manager.release(testDir)

      const instancePath = join(testDir, BRV_DIR, 'instance.json')
      let fileExists = true
      try {
        await access(instancePath)
      } catch {
        fileExists = false
      }

      expect(fileExists).to.be.false
    })

    it('should not throw when no instance exists', async () => {
      // Should not throw
      await manager.release(testDir)
    })
  })

  describe('updateSessionId', () => {
    it('should update the session ID', async () => {
      await manager.acquire(testDir, 9847)
      await manager.updateSessionId(testDir, 'session-123')

      const instance = await manager.load(testDir)

      expect(instance?.currentSessionId).to.equal('session-123')
    })

    it('should throw when no instance exists', async () => {
      try {
        await manager.updateSessionId(testDir, 'session-123')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.include('No instance found')
      }
    })
  })
})
