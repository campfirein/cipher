import {expect} from 'chai'
import {mkdir, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'

import {JsonMcpConfigWriter} from '../../../../../src/infra/connectors/mcp/json-mcp-config-writer.js'
import {FsFileService} from '../../../../../src/infra/file/fs-file-service.js'

describe('JsonMcpConfigWriter', () => {
  let testDir: string
  let fileService: FsFileService

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `brv-json-writer-test-${Date.now()}`)
    await mkdir(testDir, {recursive: true})
    fileService = new FsFileService()
  })

  afterEach(async () => {
    await rm(testDir, {force: true, recursive: true})
  })

  describe('exists', () => {
    it('should return fileExists=false when file does not exist', async () => {
      const writer = new JsonMcpConfigWriter({
        fileService,
        serverKeyPath: ['mcpServers', 'brv'],
      })
      const filePath = path.join(testDir, 'mcp.json')

      const result = await writer.exists(filePath)

      expect(result.fileExists).to.be.false
      expect(result.serverExists).to.be.false
    })

    it('should return serverExists=false when file exists but server entry does not', async () => {
      const writer = new JsonMcpConfigWriter({
        fileService,
        serverKeyPath: ['mcpServers', 'brv'],
      })
      const filePath = path.join(testDir, 'mcp.json')
      await writeFile(filePath, JSON.stringify({mcpServers: {}}))

      const result = await writer.exists(filePath)

      expect(result.fileExists).to.be.true
      expect(result.serverExists).to.be.false
    })

    it('should return serverExists=true when server entry exists', async () => {
      const writer = new JsonMcpConfigWriter({
        fileService,
        serverKeyPath: ['mcpServers', 'brv'],
      })
      const filePath = path.join(testDir, 'mcp.json')
      await writeFile(filePath, JSON.stringify({mcpServers: {brv: {command: 'brv'}}}))

      const result = await writer.exists(filePath)

      expect(result.fileExists).to.be.true
      expect(result.serverExists).to.be.true
    })

    it('should handle nested key paths', async () => {
      const writer = new JsonMcpConfigWriter({
        fileService,
        serverKeyPath: ['amp.mcpServers', 'brv'],
      })
      const filePath = path.join(testDir, 'settings.json')
      await writeFile(filePath, JSON.stringify({'amp.mcpServers': {brv: {command: 'brv'}}}))

      const result = await writer.exists(filePath)

      expect(result.fileExists).to.be.true
      expect(result.serverExists).to.be.true
    })

    it('should return serverExists=false for malformed JSON', async () => {
      const writer = new JsonMcpConfigWriter({
        fileService,
        serverKeyPath: ['mcpServers', 'brv'],
      })
      const filePath = path.join(testDir, 'mcp.json')
      await writeFile(filePath, 'not valid json')

      const result = await writer.exists(filePath)

      expect(result.fileExists).to.be.true
      expect(result.serverExists).to.be.false
    })
  })

  describe('write', () => {
    it('should create new file with server config', async () => {
      const writer = new JsonMcpConfigWriter({
        fileService,
        serverKeyPath: ['mcpServers', 'brv'],
      })
      const filePath = path.join(testDir, 'mcp.json')
      const serverConfig = {
        command: 'brv',
        args: ['mcp'], // eslint-disable-line perfectionist/sort-objects
      }

      await writer.write(filePath, serverConfig)

      const content = await fileService.read(filePath)
      const json = JSON.parse(content)
      expect(json.mcpServers.brv).to.deep.equal(serverConfig)
    })

    it('should add server to existing config preserving other settings', async () => {
      const writer = new JsonMcpConfigWriter({
        fileService,
        serverKeyPath: ['mcpServers', 'brv'],
      })
      const filePath = path.join(testDir, 'mcp.json')
      await writeFile(filePath, JSON.stringify({mcpServers: {other: {}}, otherSetting: true}))
      const serverConfig = {
        command: 'brv',
        args: ['mcp'], // eslint-disable-line perfectionist/sort-objects
      }

      await writer.write(filePath, serverConfig)

      const content = await fileService.read(filePath)
      const json = JSON.parse(content)
      expect(json.otherSetting).to.be.true
      expect(json.mcpServers.other).to.deep.equal({})
      expect(json.mcpServers.brv).to.deep.equal(serverConfig)
    })

    it('should overwrite existing server config', async () => {
      const writer = new JsonMcpConfigWriter({
        fileService,
        serverKeyPath: ['mcpServers', 'brv'],
      })
      const filePath = path.join(testDir, 'mcp.json')
      await writeFile(filePath, JSON.stringify({mcpServers: {brv: {command: 'old'}}}))
      const serverConfig = {
        command: 'brv',
        args: ['mcp'], // eslint-disable-line perfectionist/sort-objects
      }

      await writer.write(filePath, serverConfig)

      const content = await fileService.read(filePath)
      const json = JSON.parse(content)
      expect(json.mcpServers.brv).to.deep.equal(serverConfig)
    })

    it('should create intermediate objects in key path', async () => {
      const writer = new JsonMcpConfigWriter({
        fileService,
        serverKeyPath: ['level1', 'level2', 'brv'],
      })
      const filePath = path.join(testDir, 'config.json')
      const serverConfig = {command: 'brv'}

      await writer.write(filePath, serverConfig)

      const content = await fileService.read(filePath)
      const json = JSON.parse(content)
      expect(json.level1.level2.brv).to.deep.equal(serverConfig)
    })
  })

  describe('remove', () => {
    it('should return false when file does not exist', async () => {
      const writer = new JsonMcpConfigWriter({
        fileService,
        serverKeyPath: ['mcpServers', 'brv'],
      })
      const filePath = path.join(testDir, 'mcp.json')

      const result = await writer.remove(filePath)

      expect(result).to.be.false
    })

    it('should return false when server entry does not exist', async () => {
      const writer = new JsonMcpConfigWriter({
        fileService,
        serverKeyPath: ['mcpServers', 'brv'],
      })
      const filePath = path.join(testDir, 'mcp.json')
      await writeFile(filePath, JSON.stringify({mcpServers: {other: {}}}))

      const result = await writer.remove(filePath)

      expect(result).to.be.false
    })

    it('should remove server entry and preserve other settings', async () => {
      const writer = new JsonMcpConfigWriter({
        fileService,
        serverKeyPath: ['mcpServers', 'brv'],
      })
      const filePath = path.join(testDir, 'mcp.json')
      await writeFile(filePath, JSON.stringify({mcpServers: {brv: {}, other: {}}, setting: true}))

      const result = await writer.remove(filePath)

      expect(result).to.be.true
      const content = await fileService.read(filePath)
      const json = JSON.parse(content)
      expect(json.mcpServers.brv).to.be.undefined
      expect(json.mcpServers.other).to.deep.equal({})
      expect(json.setting).to.be.true
    })

    it('should return true when server entry is removed', async () => {
      const writer = new JsonMcpConfigWriter({
        fileService,
        serverKeyPath: ['mcpServers', 'brv'],
      })
      const filePath = path.join(testDir, 'mcp.json')
      await writeFile(filePath, JSON.stringify({mcpServers: {brv: {command: 'brv'}}}))

      const result = await writer.remove(filePath)

      expect(result).to.be.true
    })
  })
})
