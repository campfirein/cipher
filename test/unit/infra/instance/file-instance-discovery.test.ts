import {expect} from 'chai'
import {mkdir, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {BRV_DIR} from '../../../../src/server/constants.js'
import {InstanceInfo} from '../../../../src/server/core/domain/instance/types.js'
import {FileInstanceDiscovery} from '../../../../src/server/infra/instance/file-instance-discovery.js'
import {FileInstanceManager} from '../../../../src/server/infra/instance/file-instance-manager.js'

describe('FileInstanceDiscovery', () => {
  let testDir: string
  let discovery: FileInstanceDiscovery
  let manager: FileInstanceManager

  beforeEach(async () => {
    // Create a unique temp directory structure for each test
    testDir = join(tmpdir(), `brv-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(testDir, {recursive: true})

    manager = new FileInstanceManager()
    discovery = new FileInstanceDiscovery(manager)
  })

  afterEach(async () => {
    // Clean up temp directory
    try {
      await rm(testDir, {force: true, recursive: true})
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('findProjectRoot', () => {
    it('should find project root when .brv exists in current directory', async () => {
      // Create .brv directory
      await mkdir(join(testDir, BRV_DIR), {recursive: true})

      const root = await discovery.findProjectRoot(testDir)

      expect(root).to.equal(testDir)
    })

    it('should find project root when .brv exists in parent directory', async () => {
      // Create nested structure: testDir/.brv and testDir/src/components
      await mkdir(join(testDir, BRV_DIR), {recursive: true})
      const nestedDir = join(testDir, 'src', 'components')
      await mkdir(nestedDir, {recursive: true})

      const root = await discovery.findProjectRoot(nestedDir)

      expect(root).to.equal(testDir)
    })

    it('should find project root when .brv exists several levels up', async () => {
      // Create deep nested structure
      await mkdir(join(testDir, BRV_DIR), {recursive: true})
      const deepNestedDir = join(testDir, 'src', 'features', 'auth', 'components')
      await mkdir(deepNestedDir, {recursive: true})

      const root = await discovery.findProjectRoot(deepNestedDir)

      expect(root).to.equal(testDir)
    })

    it('should return undefined when no .brv exists', async () => {
      // No .brv directory
      const root = await discovery.findProjectRoot(testDir)

      expect(root).to.be.undefined
    })
  })

  describe('discover', () => {
    it('should discover running instance', async () => {
      // Acquire an instance (creates .brv/instance.json with current PID)
      await manager.acquire(testDir, 9847)

      const result = await discovery.discover(testDir)

      expect(result.found).to.be.true
      if (result.found) {
        expect(result.instance.port).to.equal(9847)
        expect(result.projectRoot).to.equal(testDir)
      }
    })

    it('should discover instance from subdirectory', async () => {
      // Acquire instance at root
      await manager.acquire(testDir, 9847)

      // Create subdirectory
      const subDir = join(testDir, 'src', 'components')
      await mkdir(subDir, {recursive: true})

      // Discover from subdirectory
      const result = await discovery.discover(subDir)

      expect(result.found).to.be.true
      if (result.found) {
        expect(result.instance.port).to.equal(9847)
        expect(result.projectRoot).to.equal(testDir)
      }
    })

    it('should return no_instance when no .brv exists', async () => {
      const result = await discovery.discover(testDir)

      expect(result.found).to.be.false
      if (!result.found) {
        expect(result.reason).to.equal('no_instance')
      }
    })

    it('should return no_instance when instance.json is deleted (released)', async () => {
      // Acquire and then release (deletes instance.json)
      await manager.acquire(testDir, 9847)
      await manager.release(testDir)

      const result = await discovery.discover(testDir)

      expect(result.found).to.be.false
      if (!result.found) {
        expect(result.reason).to.equal('no_instance')
      }
    })

    it('should return instance_crashed when PID is dead', async () => {
      // Create .brv directory
      await mkdir(join(testDir, BRV_DIR), {recursive: true})

      // Manually write instance.json with a dead PID
      const deadInstance = InstanceInfo.create({
        pid: 9_999_999, // Non-existent PID
        port: 9847,
      })
      const instancePath = join(testDir, BRV_DIR, 'instance.json')
      await writeFile(instancePath, JSON.stringify(deadInstance.toJson(), null, 2))

      const result = await discovery.discover(testDir)

      expect(result.found).to.be.false
      if (!result.found) {
        expect(result.reason).to.equal('instance_crashed')
      }
    })
  })
})
