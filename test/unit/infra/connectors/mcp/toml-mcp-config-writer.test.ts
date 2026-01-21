import {expect} from 'chai'
import {mkdir, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'

import {
  BRV_MCP_TOML_MARKERS,
  TomlMcpConfigWriter,
} from '../../../../../src/infra/connectors/mcp/toml-mcp-config-writer.js'
import {FsFileService} from '../../../../../src/infra/file/fs-file-service.js'

describe('TomlMcpConfigWriter', () => {
  let testDir: string
  let fileService: FsFileService

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `brv-toml-writer-test-${Date.now()}`)
    await mkdir(testDir, {recursive: true})
    fileService = new FsFileService()
  })

  afterEach(async () => {
    await rm(testDir, {force: true, recursive: true})
  })

  describe('BRV_MCP_TOML_MARKERS', () => {
    it('should have correct marker values', () => {
      expect(BRV_MCP_TOML_MARKERS.START).to.equal('# BEGIN BYTEROVER MCP')
      expect(BRV_MCP_TOML_MARKERS.END).to.equal('# END BYTEROVER MCP')
    })
  })

  describe('exists', () => {
    it('should return fileExists=false when file does not exist', async () => {
      const writer = new TomlMcpConfigWriter({
        fileService,
        serverName: 'brv',
      })
      const filePath = path.join(testDir, 'config.toml')

      const result = await writer.exists(filePath)

      expect(result.fileExists).to.be.false
      expect(result.serverExists).to.be.false
    })

    it('should return serverExists=false when file exists but no markers', async () => {
      const writer = new TomlMcpConfigWriter({
        fileService,
        serverName: 'brv',
      })
      const filePath = path.join(testDir, 'config.toml')
      await writeFile(filePath, '[some_section]\nkey = "value"')

      const result = await writer.exists(filePath)

      expect(result.fileExists).to.be.true
      expect(result.serverExists).to.be.false
    })

    it('should return serverExists=true when markers exist', async () => {
      const writer = new TomlMcpConfigWriter({
        fileService,
        serverName: 'brv',
      })
      const filePath = path.join(testDir, 'config.toml')
      const content = `[other]\n${BRV_MCP_TOML_MARKERS.START}\n[mcp_servers.brv]\ncommand = "brv"\n${BRV_MCP_TOML_MARKERS.END}`
      await writeFile(filePath, content)

      const result = await writer.exists(filePath)

      expect(result.fileExists).to.be.true
      expect(result.serverExists).to.be.true
    })

    it('should return serverExists=false when only start marker exists', async () => {
      const writer = new TomlMcpConfigWriter({
        fileService,
        serverName: 'brv',
      })
      const filePath = path.join(testDir, 'config.toml')
      await writeFile(filePath, `${BRV_MCP_TOML_MARKERS.START}\n[mcp_servers.brv]`)

      const result = await writer.exists(filePath)

      expect(result.fileExists).to.be.true
      expect(result.serverExists).to.be.false
    })
  })

  describe('write', () => {
    it('should create new file with markers and TOML content', async () => {
      const writer = new TomlMcpConfigWriter({
        fileService,
        serverName: 'brv',
      })
      const filePath = path.join(testDir, 'config.toml')
      const serverConfig = {
        command: 'brv',
        args: ['mcp'], // eslint-disable-line perfectionist/sort-objects
      }

      await writer.write(filePath, serverConfig)

      const content = await fileService.read(filePath)
      expect(content).to.include(BRV_MCP_TOML_MARKERS.START)
      expect(content).to.include(BRV_MCP_TOML_MARKERS.END)
      expect(content).to.include('[mcp_servers.brv]')
      expect(content).to.include('command = "brv"')
      expect(content).to.include('args = ["mcp"]')
    })

    it('should append to existing file without markers', async () => {
      const writer = new TomlMcpConfigWriter({
        fileService,
        serverName: 'brv',
      })
      const filePath = path.join(testDir, 'config.toml')
      await writeFile(filePath, '[existing]\nkey = "value"')
      const serverConfig = {command: 'brv'}

      await writer.write(filePath, serverConfig)

      const content = await fileService.read(filePath)
      expect(content).to.include('[existing]')
      expect(content).to.include('key = "value"')
      expect(content).to.include(BRV_MCP_TOML_MARKERS.START)
      expect(content).to.include('[mcp_servers.brv]')
    })

    it('should replace existing markers section', async () => {
      const writer = new TomlMcpConfigWriter({
        fileService,
        serverName: 'brv',
      })
      const filePath = path.join(testDir, 'config.toml')
      const existingContent = `[before]\nkey = "a"\n\n${BRV_MCP_TOML_MARKERS.START}\n[mcp_servers.brv]\ncommand = "old"\n${BRV_MCP_TOML_MARKERS.END}\n\n[after]\nkey = "b"`
      await writeFile(filePath, existingContent)
      const serverConfig = {
        command: 'brv',
        args: ['mcp'], // eslint-disable-line perfectionist/sort-objects
      }

      await writer.write(filePath, serverConfig)

      const content = await fileService.read(filePath)
      expect(content).to.include('[before]')
      expect(content).to.include('[after]')
      expect(content).to.include('command = "brv"')
      expect(content).to.include('args = ["mcp"]')
      expect(content).not.to.include('command = "old"')
      // Should have exactly one pair of markers
      expect(content.split(BRV_MCP_TOML_MARKERS.START).length).to.equal(2)
      expect(content.split(BRV_MCP_TOML_MARKERS.END).length).to.equal(2)
    })

    it('should handle different data types in server config', async () => {
      const writer = new TomlMcpConfigWriter({
        fileService,
        serverName: 'brv',
      })
      const filePath = path.join(testDir, 'config.toml')
      const serverConfig = {
        command: 'brv',
        port: 3000,
        enabled: true, // eslint-disable-line perfectionist/sort-objects
        tags: ['a', 'b'],
      }

      await writer.write(filePath, serverConfig)

      const content = await fileService.read(filePath)
      expect(content).to.include('command = "brv"')
      expect(content).to.include('port = 3000')
      expect(content).to.include('enabled = true')
      expect(content).to.include('tags = ["a", "b"]')
    })
  })

  describe('remove', () => {
    it('should return false when file does not exist', async () => {
      const writer = new TomlMcpConfigWriter({
        fileService,
        serverName: 'brv',
      })
      const filePath = path.join(testDir, 'config.toml')

      const result = await writer.remove(filePath)

      expect(result).to.be.false
    })

    it('should return false when no markers exist', async () => {
      const writer = new TomlMcpConfigWriter({
        fileService,
        serverName: 'brv',
      })
      const filePath = path.join(testDir, 'config.toml')
      await writeFile(filePath, '[some_section]\nkey = "value"')

      const result = await writer.remove(filePath)

      expect(result).to.be.false
    })

    it('should remove markers section and preserve other content', async () => {
      const writer = new TomlMcpConfigWriter({
        fileService,
        serverName: 'brv',
      })
      const filePath = path.join(testDir, 'config.toml')
      const existingContent = `[before]\nkey = "a"\n\n${BRV_MCP_TOML_MARKERS.START}\n[mcp_servers.brv]\ncommand = "brv"\n${BRV_MCP_TOML_MARKERS.END}\n\n[after]\nkey = "b"`
      await writeFile(filePath, existingContent)

      const result = await writer.remove(filePath)

      expect(result).to.be.true
      const content = await fileService.read(filePath)
      expect(content).to.include('[before]')
      expect(content).to.include('[after]')
      expect(content).not.to.include(BRV_MCP_TOML_MARKERS.START)
      expect(content).not.to.include(BRV_MCP_TOML_MARKERS.END)
      expect(content).not.to.include('[mcp_servers.brv]')
    })

    it('should delete file if only markers section remains', async () => {
      const writer = new TomlMcpConfigWriter({
        fileService,
        serverName: 'brv',
      })
      const filePath = path.join(testDir, 'config.toml')
      const content = `${BRV_MCP_TOML_MARKERS.START}\n[mcp_servers.brv]\ncommand = "brv"\n${BRV_MCP_TOML_MARKERS.END}`
      await writeFile(filePath, content)

      const result = await writer.remove(filePath)

      expect(result).to.be.true
      const exists = await fileService.exists(filePath)
      expect(exists).to.be.false
    })

    it('should return true when markers are removed', async () => {
      const writer = new TomlMcpConfigWriter({
        fileService,
        serverName: 'brv',
      })
      const filePath = path.join(testDir, 'config.toml')
      const content = `[other]\nkey = "value"\n\n${BRV_MCP_TOML_MARKERS.START}\n[mcp_servers.brv]\ncommand = "brv"\n${BRV_MCP_TOML_MARKERS.END}`
      await writeFile(filePath, content)

      const result = await writer.remove(filePath)

      expect(result).to.be.true
    })
  })
})
