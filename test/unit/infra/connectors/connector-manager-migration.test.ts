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
    // No orphaned rule files exist in testDir, so no agents should be cleaned
    const results = await connectorManager.migrateOrphanedConnectors()
    expect(results).to.be.an('array').that.is.empty
  })

  it('should not clean rule files for agents that now support MCP', async () => {
    // Cline supports MCP — its rule file should NOT be treated as orphaned
    const ruleDir = path.join(testDir, '.clinerules')
    await mkdir(ruleDir, {recursive: true})
    const ruleContent = `${BRV_RULE_MARKERS.START}\nMock MCP rule content\nUse brv-query to query context\nUse brv-curate to store context\n${BRV_RULE_MARKERS.END}`
    await writeFile(path.join(ruleDir, 'agent-context.md'), ruleContent)

    const results = await connectorManager.migrateOrphanedConnectors()

    const clineResult = results.find((r) => r.agent === 'Cline')
    expect(clineResult).to.be.undefined
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

  it('should have no orphaned MCP agents when all MCP-configured agents support MCP', async () => {
    const orphanedAgents = (Object.keys(MCP_CONNECTOR_CONFIGS) as McpSupportedAgent[]).filter(
      (agent) => !AGENT_CONNECTOR_CONFIG[agent].supported.includes('mcp'),
    )

    // All agents with MCP configs should also have 'mcp' in their supported list
    expect(orphanedAgents).to.be.an('array').that.is.empty
  })
})
