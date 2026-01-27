import {expect} from 'chai'
import {mkdir, rm, writeFile} from 'node:fs/promises'
import {homedir, tmpdir} from 'node:os'
import path from 'node:path'

import type {IRuleTemplateService} from '../../../../../src/server/core/interfaces/services/i-rule-template-service.js'
import type {
  JsonMcpConnectorConfig,
  McpSupportedAgent,
} from '../../../../../src/server/infra/connectors/mcp/mcp-connector-config.js'

import {MCP_CONNECTOR_CONFIGS} from '../../../../../src/server/infra/connectors/mcp/mcp-connector-config.js'
import {McpConnector} from '../../../../../src/server/infra/connectors/mcp/mcp-connector.js'
import {BRV_RULE_MARKERS} from '../../../../../src/server/infra/connectors/shared/constants.js'
import {FsFileService} from '../../../../../src/server/infra/file/fs-file-service.js'

/**
 * Mock template service for testing.
 * Includes brv-query and brv-curate tool references to simulate MCP content.
 */
const createMockTemplateService = (): IRuleTemplateService => ({
  generateRuleContent: async () =>
    `${BRV_RULE_MARKERS.START}\nMock MCP rule content\nUse brv-query to query context\nUse brv-curate to store context\n${BRV_RULE_MARKERS.END}`,
})

describe('McpConnector', () => {
  let testDir: string
  let fileService: FsFileService
  let mcpConnector: McpConnector
  let templateService: IRuleTemplateService

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `brv-mcp-test-${Date.now()}`)
    await mkdir(testDir, {recursive: true})
    fileService = new FsFileService()
    templateService = createMockTemplateService()
    mcpConnector = new McpConnector({
      fileService,
      projectRoot: testDir,
      templateService,
    })
  })

  afterEach(async () => {
    await rm(testDir, {force: true, recursive: true})
  })

  describe('type', () => {
    it('should have type "mcp"', () => {
      expect(mcpConnector.type).to.equal('mcp')
    })
  })

  describe('getSupportedAgents', () => {
    it('should return multiple supported agents', () => {
      const agents = mcpConnector.getSupportedAgents()
      expect(agents).to.include('Claude Code')
      expect(agents).to.include('Cursor')
      expect(agents).to.include('Windsurf')
      expect(agents.length).to.be.greaterThan(3)
    })
  })

  describe('isSupported', () => {
    it('should return true for Claude Code', () => {
      expect(mcpConnector.isSupported('Claude Code')).to.be.true
    })

    it('should return true for Cursor', () => {
      expect(mcpConnector.isSupported('Cursor')).to.be.true
    })

    it('should return true for Windsurf', () => {
      expect(mcpConnector.isSupported('Windsurf')).to.be.true
    })

    it('should return true for Cline', () => {
      expect(mcpConnector.isSupported('Cline')).to.be.true
    })

    it('should return true for Roo Code', () => {
      expect(mcpConnector.isSupported('Roo Code')).to.be.true
    })

    it('should return true for Amp', () => {
      expect(mcpConnector.isSupported('Amp')).to.be.true
    })

    it('should return true for Codex', () => {
      expect(mcpConnector.isSupported('Codex')).to.be.true
    })
  })

  describe('getConfigPath', () => {
    it('should return config path for Claude Code', () => {
      expect(mcpConnector.getConfigPath('Claude Code')).to.equal(path.join(testDir, '.mcp.json'))
    })

    it('should return config path for Cursor', () => {
      expect(mcpConnector.getConfigPath('Cursor')).to.equal(path.join(testDir, '.cursor/mcp.json'))
    })

    it('should return config path for Windsurf (global scope)', () => {
      // Windsurf is a global scope agent, configPath is relative to os.homedir()
      expect(mcpConnector.getConfigPath('Windsurf')).to.equal(path.join(homedir(), '.codeium/windsurf/mcp_config.json'))
    })

    it('should return empty string for global scope agents without configPath', () => {
      // Manual mode global agents may not have configPath set
      expect(mcpConnector.getConfigPath('Cline')).to.equal('')
    })

    it('should return config path for Codex (TOML format)', () => {
      expect(mcpConnector.getConfigPath('Codex')).to.equal(path.join(homedir(), '.codex/config.toml'))
    })
  })

  // Test each supported agent with project-level config (has configPath and mode: 'auto')
  const testAgents: Array<{agent: McpSupportedAgent; configDir: string}> = [
    {agent: 'Claude Code', configDir: '.'},
    {agent: 'Cursor', configDir: '.cursor'},
    {agent: 'Roo Code', configDir: '.roo'},
  ]

  for (const {agent, configDir} of testAgents) {
    describe(`${agent}`, () => {
      const {configPath, serverConfig} = MCP_CONNECTOR_CONFIGS[agent] as JsonMcpConnectorConfig

      describe('install', () => {
        it('should create new config file if not exists', async () => {
          const result = await mcpConnector.install(agent)

          expect(result.success).to.be.true
          expect(result.alreadyInstalled).to.be.false
          expect(result.configPath).to.equal(path.join(testDir, configPath!))

          const content = await fileService.read(path.join(testDir, configPath!))
          const json = JSON.parse(content)
          expect(json.mcpServers.brv).to.deep.equal(serverConfig)
        })

        it('should add MCP server to existing config without other servers', async () => {
          const existingConfig = {someOtherSetting: true}
          await mkdir(path.join(testDir, configDir), {recursive: true})
          await writeFile(path.join(testDir, configPath!), JSON.stringify(existingConfig))

          const result = await mcpConnector.install(agent)

          expect(result.success).to.be.true
          expect(result.alreadyInstalled).to.be.false

          const content = await fileService.read(path.join(testDir, configPath!))
          const json = JSON.parse(content)
          expect(json.someOtherSetting).to.be.true // preserved
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
          await mkdir(path.join(testDir, configDir), {recursive: true})
          await writeFile(path.join(testDir, configPath!), JSON.stringify(existingConfig))

          const result = await mcpConnector.install(agent)

          expect(result.success).to.be.true
          expect(result.alreadyInstalled).to.be.false

          const content = await fileService.read(path.join(testDir, configPath!))
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
          await mkdir(path.join(testDir, configDir), {recursive: true})
          await writeFile(path.join(testDir, configPath!), JSON.stringify(existingConfig))

          const result = await mcpConnector.install(agent)

          expect(result.success).to.be.true
          expect(result.alreadyInstalled).to.be.true
        })
      })

      describe('uninstall', () => {
        it('should return wasInstalled false if config not exists', async () => {
          const result = await mcpConnector.uninstall(agent)

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
          await mkdir(path.join(testDir, configDir), {recursive: true})
          await writeFile(path.join(testDir, configPath!), JSON.stringify(existingConfig))

          const result = await mcpConnector.uninstall(agent)

          expect(result.success).to.be.true
          expect(result.wasInstalled).to.be.true

          const content = await fileService.read(path.join(testDir, configPath!))
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
          await mkdir(path.join(testDir, configDir), {recursive: true})
          await writeFile(path.join(testDir, configPath!), JSON.stringify(existingConfig))

          const result = await mcpConnector.uninstall(agent)

          expect(result.success).to.be.true
          expect(result.wasInstalled).to.be.false
        })
      })

      describe('status', () => {
        it('should return configExists false if file not exists', async () => {
          const result = await mcpConnector.status(agent)

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
          await mkdir(path.join(testDir, configDir), {recursive: true})
          await writeFile(path.join(testDir, configPath!), JSON.stringify(existingConfig))

          const result = await mcpConnector.status(agent)

          expect(result.configExists).to.be.true
          expect(result.installed).to.be.true
          expect(result.error).to.be.undefined
        })

        it('should return installed false if server not present', async () => {
          const existingConfig = {mcpServers: {}}
          await mkdir(path.join(testDir, configDir), {recursive: true})
          await writeFile(path.join(testDir, configPath!), JSON.stringify(existingConfig))

          const result = await mcpConnector.status(agent)

          expect(result.configExists).to.be.true
          expect(result.installed).to.be.false
          expect(result.error).to.be.undefined
        })
      })
    })
  }

  describe('unsupported agent', () => {
    it('should return failure for unsupported agent on install', async () => {
      // Cast to bypass type checking for testing unsupported agent behavior
      const result = await mcpConnector.install('NonExistentAgent' as never)

      expect(result.success).to.be.false
      expect(result.message).to.include('does not support agent')
    })

    it('should return failure for unsupported agent on uninstall', async () => {
      const result = await mcpConnector.uninstall('NonExistentAgent' as never)

      expect(result.success).to.be.false
      expect(result.message).to.include('does not support agent')
    })

    it('should return error status for unsupported agent', async () => {
      const result = await mcpConnector.status('NonExistentAgent' as never)

      expect(result.configExists).to.be.false
      expect(result.installed).to.be.false
      expect(result.error).to.include('does not support agent')
    })
  })

  describe('edge cases', () => {
    it('should handle malformed JSON gracefully on install', async () => {
      await mkdir(path.join(testDir, '.cursor'), {recursive: true})
      await writeFile(path.join(testDir, '.cursor/mcp.json'), 'not valid json')

      const result = await mcpConnector.install('Cursor')

      expect(result.success).to.be.false
      expect(result.message).to.include('Failed to install')
    })

    it('should handle malformed JSON gracefully on status', async () => {
      await mkdir(path.join(testDir, '.cursor'), {recursive: true})
      await writeFile(path.join(testDir, '.cursor/mcp.json'), 'not valid json')

      const result = await mcpConnector.status('Cursor')

      // Malformed JSON is treated as file exists but server not found
      expect(result.configExists).to.be.true
      expect(result.installed).to.be.false
    })

    it('should handle empty mcpServers object', async () => {
      const existingConfig = {mcpServers: {}}
      await mkdir(path.join(testDir, '.cursor'), {recursive: true})
      await writeFile(path.join(testDir, '.cursor/mcp.json'), JSON.stringify(existingConfig))

      const result = await mcpConnector.install('Cursor')

      expect(result.success).to.be.true
      expect(result.alreadyInstalled).to.be.false

      const content = await fileService.read(path.join(testDir, '.cursor/mcp.json'))
      const json = JSON.parse(content)
      expect(json.mcpServers.brv).to.deep.equal(MCP_CONNECTOR_CONFIGS.Cursor.serverConfig)
    })

    it('should handle config with nested structure but no mcpServers', async () => {
      const existingConfig = {
        settings: {
          theme: 'dark',
        },
      }
      await mkdir(path.join(testDir, '.cursor'), {recursive: true})
      await writeFile(path.join(testDir, '.cursor/mcp.json'), JSON.stringify(existingConfig))

      const result = await mcpConnector.install('Cursor')

      expect(result.success).to.be.true

      const content = await fileService.read(path.join(testDir, '.cursor/mcp.json'))
      const json = JSON.parse(content)
      expect(json.settings.theme).to.equal('dark') // preserved
      expect(json.mcpServers.brv).to.deep.equal(MCP_CONNECTOR_CONFIGS.Cursor.serverConfig)
    })
  })

  describe('manual mode', () => {
    // Test agents with mode: 'manual'
    const manualAgents: McpSupportedAgent[] = ['Cline', 'Augment Code', 'Qoder', 'Trae.ai', 'Warp']

    for (const agent of manualAgents) {
      describe(`${agent} (manual mode)`, () => {
        it('should return manual instructions instead of writing files', async () => {
          const result = await mcpConnector.install(agent)

          expect(result.success).to.be.true
          expect(result.requiresManualSetup).to.be.true
          expect(result.alreadyInstalled).to.be.false
          expect(result.manualInstructions).to.exist
          expect(result.manualInstructions!.configContent).to.be.a('string')
          expect(result.manualInstructions!.configContent.length).to.be.greaterThan(0)
        })

        it('should include guide URL in manual instructions', async () => {
          const result = await mcpConnector.install(agent)

          expect(result.manualInstructions!.guide).to.be.a('string')
          // All manual mode agents should have a guide URL
          expect(result.manualInstructions!.guide.length).to.be.greaterThan(0)
          expect(result.manualInstructions!.guide).to.include('http')
        })

        it('should have configContent containing brv server config', async () => {
          const result = await mcpConnector.install(agent)

          expect(result.manualInstructions!.configContent).to.include('brv')
        })
      })
    }

    it('should format JSON config content correctly for JSON agents', async () => {
      const result = await mcpConnector.install('Augment Code')

      expect(result.manualInstructions!.configContent).to.include('"brv"')
      expect(result.manualInstructions!.configContent).to.include('"command"')
      expect(result.manualInstructions!.configContent).to.include('"args"')
    })

    describe('status', () => {
      it('should return installed=false when rule file does not exist', async () => {
        const result = await mcpConnector.status('Cline')

        expect(result.configExists).to.be.false
        expect(result.installed).to.be.false
      })

      it('should return installed=false when rule file exists but has no markers', async () => {
        await mkdir(path.join(testDir, '.clinerules'), {recursive: true})
        await writeFile(path.join(testDir, '.clinerules/agent-context.md'), 'Some content without markers')

        const result = await mcpConnector.status('Cline')

        expect(result.configExists).to.be.true
        expect(result.installed).to.be.false
      })

      it('should return installed=false when rule file has markers but no MCP tools', async () => {
        await mkdir(path.join(testDir, '.clinerules'), {recursive: true})
        const rulesOnlyContent = `${BRV_RULE_MARKERS.START}\nSome rules content without MCP tools\n${BRV_RULE_MARKERS.END}`
        await writeFile(path.join(testDir, '.clinerules/agent-context.md'), rulesOnlyContent)

        const result = await mcpConnector.status('Cline')

        expect(result.configExists).to.be.true
        expect(result.installed).to.be.false
      })

      it('should return installed=true when rule file has markers and MCP tools', async () => {
        // First install to create the rule file with markers and MCP content
        await mcpConnector.install('Cline')

        const result = await mcpConnector.status('Cline')

        expect(result.configExists).to.be.true
        expect(result.installed).to.be.true
        expect(result.configPath).to.equal('.clinerules/agent-context.md')
      })
    })
  })
})
