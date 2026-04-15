import {expect} from 'chai'
import {mkdir, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'

import {MCP_CONNECTOR_CONFIGS} from '../../../../../src/server/infra/connectors/mcp/mcp-connector-config.js'
import {McpConnector} from '../../../../../src/server/infra/connectors/mcp/mcp-connector.js'
import {BRV_RULE_MARKERS} from '../../../../../src/server/infra/connectors/shared/constants.js'
import {FsFileService} from '../../../../../src/server/infra/file/fs-file-service.js'

const {serverConfig} = MCP_CONNECTOR_CONFIGS['Claude Desktop']
const CONFIG_DIR = 'Claude'
const CONFIG_FILE = 'claude_desktop_config.json'

describe('Claude Desktop MCP Connector (real filesystem)', () => {
  let testDir: string
  let configPath: string
  let fileService: FsFileService
  let mcpConnector: McpConnector
  const originalConfig = {...MCP_CONNECTOR_CONFIGS['Claude Desktop']}

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `brv-claude-desktop-test-${Date.now()}`)
    await mkdir(testDir, {recursive: true})
    configPath = path.join(testDir, CONFIG_DIR, CONFIG_FILE)
    fileService = new FsFileService()

    Object.assign(MCP_CONNECTOR_CONFIGS['Claude Desktop'], {
      configPathResolver: () => configPath,
    })

    mcpConnector = new McpConnector({
      fileService,
      projectRoot: testDir,
      templateService: {
        generateRuleContent: async () =>
          `${BRV_RULE_MARKERS.START}\nMock MCP rule content\nUse brv-query to query context\nUse brv-curate to store context\n${BRV_RULE_MARKERS.END}`,
      },
    })
  })

  afterEach(async () => {
    Object.assign(MCP_CONNECTOR_CONFIGS['Claude Desktop'], originalConfig)
    await rm(testDir, {force: true, recursive: true})
  })

  describe('install', () => {
    it('should create new config file if not exists', async () => {
      const result = await mcpConnector.install('Claude Desktop')

      expect(result.success).to.be.true
      expect(result.alreadyInstalled).to.be.false
      expect(result.configPath).to.equal(configPath)

      const content = await fileService.read(configPath)
      const json = JSON.parse(content)
      expect(json.mcpServers.brv).to.deep.equal(serverConfig)
    })

    it('should add MCP server to existing config without other servers', async () => {
      const existingConfig = {someOtherSetting: true}
      await mkdir(path.join(testDir, CONFIG_DIR), {recursive: true})
      await writeFile(configPath, JSON.stringify(existingConfig))

      const result = await mcpConnector.install('Claude Desktop')

      expect(result.success).to.be.true
      expect(result.alreadyInstalled).to.be.false

      const content = await fileService.read(configPath)
      const json = JSON.parse(content)
      expect(json.someOtherSetting).to.be.true
      expect(json.mcpServers.brv).to.deep.equal(serverConfig)
    })

    it('should preserve other MCP servers when installing', async () => {
      const existingConfig = {
        mcpServers: {
          'other-server': {
            command: 'other-cmd',
            args: ['arg1'], // eslint-disable-line perfectionist/sort-objects
          },
        },
      }
      await mkdir(path.join(testDir, CONFIG_DIR), {recursive: true})
      await writeFile(configPath, JSON.stringify(existingConfig))

      const result = await mcpConnector.install('Claude Desktop')

      expect(result.success).to.be.true
      expect(result.alreadyInstalled).to.be.false

      const content = await fileService.read(configPath)
      const json = JSON.parse(content)
      expect(json.mcpServers['other-server']).to.deep.equal({
        command: 'other-cmd',
        args: ['arg1'], // eslint-disable-line perfectionist/sort-objects
      })
      expect(json.mcpServers.brv).to.deep.equal(serverConfig)
    })

    it('should return alreadyInstalled if server exists', async () => {
      const existingConfig = {
        mcpServers: {
          brv: serverConfig,
        },
      }
      await mkdir(path.join(testDir, CONFIG_DIR), {recursive: true})
      await writeFile(configPath, JSON.stringify(existingConfig))

      const result = await mcpConnector.install('Claude Desktop')

      expect(result.success).to.be.true
      expect(result.alreadyInstalled).to.be.true
    })
  })

  describe('uninstall', () => {
    it('should return wasInstalled false if config not exists', async () => {
      const result = await mcpConnector.uninstall('Claude Desktop')

      expect(result.success).to.be.true
      expect(result.wasInstalled).to.be.false
    })

    it('should remove only our server and preserve others', async () => {
      const existingConfig = {
        mcpServers: {
          brv: serverConfig,
          'other-server': {
            command: 'other-cmd',
            args: [], // eslint-disable-line perfectionist/sort-objects
          },
        },
        otherSetting: 'preserved',
      }
      await mkdir(path.join(testDir, CONFIG_DIR), {recursive: true})
      await writeFile(configPath, JSON.stringify(existingConfig))

      const result = await mcpConnector.uninstall('Claude Desktop')

      expect(result.success).to.be.true
      expect(result.wasInstalled).to.be.true

      const content = await fileService.read(configPath)
      const json = JSON.parse(content)
      expect(json.mcpServers.brv).to.be.undefined
      expect(json.mcpServers['other-server']).to.deep.equal({
        command: 'other-cmd',
        args: [], // eslint-disable-line perfectionist/sort-objects
      })
      expect(json.otherSetting).to.equal('preserved')
    })

    it('should return wasInstalled false if server not present', async () => {
      const existingConfig = {
        mcpServers: {
          'other-server': {
            command: 'other-cmd',
            args: [], // eslint-disable-line perfectionist/sort-objects
          },
        },
      }
      await mkdir(path.join(testDir, CONFIG_DIR), {recursive: true})
      await writeFile(configPath, JSON.stringify(existingConfig))

      const result = await mcpConnector.uninstall('Claude Desktop')

      expect(result.success).to.be.true
      expect(result.wasInstalled).to.be.false
    })
  })

  describe('status', () => {
    it('should return configExists false if file not exists', async () => {
      const result = await mcpConnector.status('Claude Desktop')

      expect(result.configExists).to.be.false
      expect(result.installed).to.be.false
      expect(result.error).to.be.undefined
    })

    it('should return installed true if server exists', async () => {
      const existingConfig = {
        mcpServers: {
          brv: serverConfig,
        },
      }
      await mkdir(path.join(testDir, CONFIG_DIR), {recursive: true})
      await writeFile(configPath, JSON.stringify(existingConfig))

      const result = await mcpConnector.status('Claude Desktop')

      expect(result.configExists).to.be.true
      expect(result.installed).to.be.true
      expect(result.error).to.be.undefined
    })

    it('should return installed false if server not present', async () => {
      const existingConfig = {mcpServers: {}}
      await mkdir(path.join(testDir, CONFIG_DIR), {recursive: true})
      await writeFile(configPath, JSON.stringify(existingConfig))

      const result = await mcpConnector.status('Claude Desktop')

      expect(result.configExists).to.be.true
      expect(result.installed).to.be.false
      expect(result.error).to.be.undefined
    })
  })

  describe('edge cases', () => {
    it('should handle malformed JSON gracefully on install by starting fresh', async () => {
      await mkdir(path.join(testDir, CONFIG_DIR), {recursive: true})
      await writeFile(configPath, 'not valid json')

      const result = await mcpConnector.install('Claude Desktop')

      expect(result.success).to.be.true
      expect(result.alreadyInstalled).to.be.false

      const content = await fileService.read(configPath)
      const json = JSON.parse(content)
      expect(json.mcpServers.brv).to.deep.equal(serverConfig)
    })

    it('should handle malformed JSON gracefully on status', async () => {
      await mkdir(path.join(testDir, CONFIG_DIR), {recursive: true})
      await writeFile(configPath, 'not valid json')

      const result = await mcpConnector.status('Claude Desktop')

      expect(result.configExists).to.be.true
      expect(result.installed).to.be.false
    })

    it('should handle empty file gracefully on install', async () => {
      await mkdir(path.join(testDir, CONFIG_DIR), {recursive: true})
      await writeFile(configPath, '')

      const result = await mcpConnector.install('Claude Desktop')

      expect(result.success).to.be.true
      expect(result.alreadyInstalled).to.be.false

      const content = await fileService.read(configPath)
      const json = JSON.parse(content)
      expect(json.mcpServers.brv).to.deep.equal(serverConfig)
    })

    it('should handle config with nested structure but no mcpServers', async () => {
      const existingConfig = {
        settings: {
          theme: 'dark',
        },
      }
      await mkdir(path.join(testDir, CONFIG_DIR), {recursive: true})
      await writeFile(configPath, JSON.stringify(existingConfig))

      const result = await mcpConnector.install('Claude Desktop')

      expect(result.success).to.be.true

      const content = await fileService.read(configPath)
      const json = JSON.parse(content)
      expect(json.settings.theme).to.equal('dark')
      expect(json.mcpServers.brv).to.deep.equal(serverConfig)
    })
  })
})
