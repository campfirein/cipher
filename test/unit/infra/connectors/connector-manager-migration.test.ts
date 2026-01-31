import {expect} from 'chai'
import {mkdir, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'

import type {IRuleTemplateService} from '../../../../src/server/core/interfaces/services/i-rule-template-service.js'

import {AGENT_CONNECTOR_CONFIG} from '../../../../src/server/core/domain/entities/agent.js'
import {ConnectorManager} from '../../../../src/server/infra/connectors/connector-manager.js'
import {
  MCP_CONNECTOR_CONFIGS,
  type McpSupportedAgent,
} from '../../../../src/server/infra/connectors/mcp/mcp-connector-config.js'
import {BRV_RULE_MARKERS} from '../../../../src/server/infra/connectors/shared/constants.js'
import {FsFileService} from '../../../../src/server/infra/file/fs-file-service.js'

const createMockTemplateService = (): IRuleTemplateService => ({
  generateRuleContent: async () =>
    `${BRV_RULE_MARKERS.START}\nMock MCP rule content\nUse brv-query to query context\nUse brv-curate to store context\n${BRV_RULE_MARKERS.END}`,
})

describe('ConnectorManager - migrateOrphanedConnectors (orphaned connector cleanup)', () => {
  let testDir: string
  let fileService: FsFileService
  let connectorManager: ConnectorManager
  let templateService: IRuleTemplateService

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `brv-migration-test-${Date.now()}`)
    await mkdir(testDir, {recursive: true})
    fileService = new FsFileService()
    templateService = createMockTemplateService()
    connectorManager = new ConnectorManager({
      fileService,
      projectRoot: testDir,
      templateService,
    })
  })

  afterEach(async () => {
    await rm(testDir, {force: true, recursive: true})
  })

  it('should not include results for agents without orphaned configs', async () => {
    // No orphaned rule files exist in testDir, so no project-scoped agents should be cleaned
    const results = await connectorManager.migrateOrphanedConnectors()
    // Only check project-scoped manual agents (global-scoped configs like Windsurf
    // may or may not exist on the developer's machine)
    const projectManualAgents = ['Cline', 'Qoder', 'Trae.ai']
    for (const agent of projectManualAgents) {
      expect(results.find((r) => r.agent === agent)).to.be.undefined
    }
  })

  it('should detect and clean orphaned manual-mode connector rule files', async () => {
    // Cline is manual-mode and its rule file is at .clinerules/agent-context.md
    const agent = 'Cline' as McpSupportedAgent

    // Verify Cline does NOT support MCP in current config
    expect(AGENT_CONNECTOR_CONFIG.Cline.supported).to.not.include('mcp')

    // Simulate an orphaned rule file (installed when connector was supported)
    const ruleDir = path.join(testDir, '.clinerules')
    await mkdir(ruleDir, {recursive: true})
    const ruleContent = `${BRV_RULE_MARKERS.START}\nMock MCP rule content\nUse brv-query to query context\nUse brv-curate to store context\n${BRV_RULE_MARKERS.END}`
    await writeFile(path.join(ruleDir, 'agent-context.md'), ruleContent)

    const results = await connectorManager.migrateOrphanedConnectors()

    const clineResult = results.find((r) => r.agent === agent)
    expect(clineResult).to.exist
    expect(clineResult!.success).to.be.true
  })

  it('should clean orphaned rule files for multiple manual-mode agents', async () => {
    const manualAgents = ['Cline', 'Trae.ai'] as const
    const rulePaths: Record<string, string> = {
      Cline: '.clinerules/agent-context.md',
      'Trae.ai': 'project_rules.md',
    }

    for (const agent of manualAgents) {
      const filePath = rulePaths[agent]
      const fullPath = path.join(testDir, filePath)
      // eslint-disable-next-line no-await-in-loop
      await mkdir(path.dirname(fullPath), {recursive: true})

      const ruleContent = `${BRV_RULE_MARKERS.START}\nMock MCP rule content\nUse brv-query to query context\nUse brv-curate to store context\n${BRV_RULE_MARKERS.END}`
      // eslint-disable-next-line no-await-in-loop
      await writeFile(fullPath, ruleContent)
    }

    const results = await connectorManager.migrateOrphanedConnectors()

    for (const agent of manualAgents) {
      const result = results.find((r) => r.agent === agent)
      expect(result, `Expected migration result for ${agent}`).to.exist
      expect(result!.success).to.be.true
    }
  })

  it('should skip agents that still legitimately support the connector', async () => {
    // Claude Code supports MCP - install a config for it
    const mcpDir = path.join(testDir)
    const mcpConfig = {mcpServers: {args: ['mcp'], brv: {command: 'brv'}}}
    await writeFile(path.join(mcpDir, '.mcp.json'), JSON.stringify(mcpConfig))

    const results = await connectorManager.migrateOrphanedConnectors()

    const claudeResult = results.find((r) => r.agent === 'Claude Code')
    expect(claudeResult).to.be.undefined
  })

  it('should skip agents with no connector config installed', async () => {
    // Cline has no rule file on disk - should not appear in results
    const results = await connectorManager.migrateOrphanedConnectors()

    const clineResult = results.find((r) => r.agent === 'Cline')
    expect(clineResult).to.be.undefined
  })

  it('should only include orphaned agents that have connector configs but are not in supported', async () => {
    const orphanedAgents = (Object.keys(MCP_CONNECTOR_CONFIGS) as McpSupportedAgent[]).filter(
      (agent) => !AGENT_CONNECTOR_CONFIG[agent].supported.includes('mcp'),
    )

    // Verify we have the expected orphaned agents
    expect(orphanedAgents).to.include.members([
      'Augment Code',
      'Cline',
      'Qoder',
      'Qwen Code',
      'Trae.ai',
      'Warp',
      'Windsurf',
    ])

    // None of the agents that still support the connector should be in orphaned list
    const mcpSupportedAgents = Object.entries(AGENT_CONNECTOR_CONFIG)
      .filter(([_, config]) => config.supported.includes('mcp'))
      .map(([agent]) => agent)

    for (const agent of mcpSupportedAgents) {
      expect(orphanedAgents).to.not.include(agent)
    }
  })
})
