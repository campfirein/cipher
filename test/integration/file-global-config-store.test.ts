import {expect} from 'chai'
import {existsSync} from 'node:fs'
import {mkdir, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {GLOBAL_CONFIG_VERSION} from '../../src/constants.js'
import {GlobalConfig} from '../../src/core/domain/entities/global-config.js'
import {FileGlobalConfigStore} from '../../src/infra/storage/file-global-config-store.js'

describe('FileGlobalConfigStore', () => {
  let testDir: string
  let testConfigPath: string
  let store: FileGlobalConfigStore

  beforeEach(async () => {
    // Create a unique temporary directory for each test
    testDir = join(tmpdir(), `test-global-config-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`)
    testConfigPath = join(testDir, 'config.json')

    // Use dependency injection to provide test paths
    store = new FileGlobalConfigStore({
      getConfigDir: () => testDir,
      getConfigPath: () => testConfigPath,
    })
  })

  afterEach(async () => {
    // Clean up test directory
    if (existsSync(testDir)) {
      await rm(testDir, {force: true, recursive: true})
    }
  })

  describe('read()', () => {
    it('should return undefined when config file does not exist', async () => {
      const result = await store.read()

      expect(result).to.be.undefined
    })

    it('should return GlobalConfig when valid config file exists', async () => {
      const deviceId = '550e8400-e29b-41d4-a716-446655440000'
      const configData = {
        deviceId,
        version: GLOBAL_CONFIG_VERSION,
      }

      await mkdir(testDir, {recursive: true})
      await writeFile(testConfigPath, JSON.stringify(configData), 'utf8')

      const result = await store.read()

      expect(result).to.not.be.undefined
      expect(result?.deviceId).to.equal(deviceId)
      expect(result?.version).to.equal(GLOBAL_CONFIG_VERSION)
    })

    it('should return undefined for corrupted JSON', async () => {
      await mkdir(testDir, {recursive: true})
      await writeFile(testConfigPath, 'not valid json', 'utf8')

      const result = await store.read()

      expect(result).to.be.undefined
    })

    it('should return undefined for invalid config structure', async () => {
      await mkdir(testDir, {recursive: true})
      await writeFile(testConfigPath, JSON.stringify({invalid: 'data'}), 'utf8')

      const result = await store.read()

      expect(result).to.be.undefined
    })

    it('should return undefined for empty deviceId', async () => {
      await mkdir(testDir, {recursive: true})
      await writeFile(testConfigPath, JSON.stringify({deviceId: '', version: '0.0.1'}), 'utf8')

      const result = await store.read()

      expect(result).to.be.undefined
    })
  })

  describe('write()', () => {
    it('should create config directory if it does not exist', async () => {
      const config = GlobalConfig.create('550e8400-e29b-41d4-a716-446655440000')

      await store.write(config)

      expect(existsSync(testDir)).to.be.true
    })

    it('should write config file with correct content', async () => {
      const deviceId = '550e8400-e29b-41d4-a716-446655440000'
      const config = GlobalConfig.create(deviceId)

      await store.write(config)

      expect(existsSync(testConfigPath)).to.be.true

      // Verify by reading back
      const readConfig = await store.read()
      expect(readConfig?.deviceId).to.equal(deviceId)
      expect(readConfig?.version).to.equal(GLOBAL_CONFIG_VERSION)
    })

    it('should overwrite existing config file', async () => {
      const oldDeviceId = '11111111-1111-1111-1111-111111111111'
      const newDeviceId = '22222222-2222-2222-2222-222222222222'

      // Write initial config
      await store.write(GlobalConfig.create(oldDeviceId))

      // Overwrite with new config
      await store.write(GlobalConfig.create(newDeviceId))

      const result = await store.read()
      expect(result?.deviceId).to.equal(newDeviceId)
    })
  })

  describe('getOrCreateDeviceId()', () => {
    it('should return existing deviceId when config exists', async () => {
      const existingDeviceId = '550e8400-e29b-41d4-a716-446655440000'
      const config = GlobalConfig.create(existingDeviceId)

      await mkdir(testDir, {recursive: true})
      await writeFile(testConfigPath, JSON.stringify(config.toJson()), 'utf8')

      const result = await store.getOrCreateDeviceId()

      expect(result).to.equal(existingDeviceId)
    })

    it('should generate new UUID when config does not exist', async () => {
      const result = await store.getOrCreateDeviceId()

      // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
      expect(result).to.match(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i)
    })

    it('should persist newly generated deviceId', async () => {
      const deviceId = await store.getOrCreateDeviceId()

      // Read back and verify
      const config = await store.read()
      expect(config?.deviceId).to.equal(deviceId)
    })

    it('should return same deviceId on subsequent calls', async () => {
      const firstCall = await store.getOrCreateDeviceId()
      const secondCall = await store.getOrCreateDeviceId()

      expect(firstCall).to.equal(secondCall)
    })

    it('should regenerate deviceId when config is corrupted', async () => {
      await mkdir(testDir, {recursive: true})
      await writeFile(testConfigPath, 'corrupted content', 'utf8')

      const result = await store.getOrCreateDeviceId()

      // Should generate a new valid UUID
      expect(result).to.match(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i)

      // Config should now be valid
      const config = await store.read()
      expect(config?.deviceId).to.equal(result)
    })
  })

  describe('regenerateDeviceId()', () => {
    it('should generate a valid UUID v4', async () => {
      const deviceId = await store.regenerateDeviceId()

      // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
      expect(deviceId).to.match(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i)
    })

    it('should persist the new device ID', async () => {
      const newDeviceId = await store.regenerateDeviceId()

      const config = await store.read()
      expect(config?.deviceId).to.equal(newDeviceId)
    })

    it('should return a different device ID than the previous one', async () => {
      const oldDeviceId = await store.getOrCreateDeviceId()
      const newDeviceId = await store.regenerateDeviceId()

      expect(newDeviceId).to.not.equal(oldDeviceId)
    })

    it('should overwrite existing config with new device ID', async () => {
      const existingDeviceId = '550e8400-e29b-41d4-a716-446655440000'
      const config = GlobalConfig.create(existingDeviceId)

      await mkdir(testDir, {recursive: true})
      await writeFile(testConfigPath, JSON.stringify(config.toJson()), 'utf8')

      const newDeviceId = await store.regenerateDeviceId()

      expect(newDeviceId).to.not.equal(existingDeviceId)

      const readConfig = await store.read()
      expect(readConfig?.deviceId).to.equal(newDeviceId)
    })

    it('should create config file if it does not exist', async () => {
      // No existing config
      const newDeviceId = await store.regenerateDeviceId()

      expect(existsSync(testConfigPath)).to.be.true

      const config = await store.read()
      expect(config?.deviceId).to.equal(newDeviceId)
    })

    it('should work when called multiple times in succession', async () => {
      const firstDeviceId = await store.regenerateDeviceId()
      const secondDeviceId = await store.regenerateDeviceId()
      const thirdDeviceId = await store.regenerateDeviceId()

      expect(firstDeviceId).to.not.equal(secondDeviceId)
      expect(secondDeviceId).to.not.equal(thirdDeviceId)
      expect(firstDeviceId).to.not.equal(thirdDeviceId)

      const config = await store.read()
      expect(config?.deviceId).to.equal(thirdDeviceId)
    })
  })
})
