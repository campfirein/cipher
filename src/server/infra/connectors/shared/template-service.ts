import type {Agent} from '../../../core/domain/entities/agent.js'
import type {ConnectorType} from '../../../core/domain/entities/connector-type.js'
import type {IRuleTemplateService} from '../../../core/interfaces/services/i-rule-template-service.js'
import type {ITemplateLoader} from '../../../core/interfaces/services/i-template-loader.js'

import {BRV_RULE_MARKERS, BRV_RULE_TAG} from './constants.js'

/**
 * Wraps rule content with boundary markers for identification and replacement.
 *
 * @param content The rule content to wrap.
 * @param agent The agent name for the footer tag.
 * @param header Agent-specific header.
 * @returns The wrapped content with boundary markers.
 */
const wrapContentWithBoundaryMarkers = (content: string, agent: Agent, header: string): string => {
  const parts = [BRV_RULE_MARKERS.START, header, content, '---', `${BRV_RULE_TAG} ${agent}`, BRV_RULE_MARKERS.END]
  return parts.join('\n')
}

const guideHeaders: {agent: Agent; value: string}[] = [
  {
    agent: 'Augment Code',
    value: `---
type: "always_apply"
---`,
  },
  {
    agent: 'Cursor',
    value: `---
description: ByteRover CLI Rules
alwaysApply: true
---`,
  },
  {
    agent: 'Kiro',
    value: `---
inclusion: always
---`,
  },
  {
    agent: 'Qoder',
    value: `---
trigger: always_on
alwaysApply: true
---`,
  },
  {
    agent: 'Windsurf',
    value: `---
trigger: always_on
---`,
  },
]

/**
 * Service for generating rule templates for different agents.
 * Loads templates from external files and assembles them with agent-specific context.
 */
export class RuleTemplateService implements IRuleTemplateService {
  constructor(private readonly templateLoader: ITemplateLoader) {}

  /**
   * Generates rule content for the specified agent by loading and assembling templates.
   * @param agent The agent for which to generate rules.
   * @returns Promise resolving to the rule content as a string.
   * @throws Error if templates cannot be loaded or assembled.
   */
  public async generateRuleContent(agent: Agent, type?: ConnectorType): Promise<string> {
    try {
      // Load section templates
      let content: string
      switch (type) {
        case 'mcp': {
          content = await this.generateMcpContent()
          break
        }

        case 'rules': {
          content = await this.generateCliContent(agent)
          break
        }

        default: {
          throw new Error(`Unsupported connector type: ${type}`)
        }
      }

      // Add agent-specific header if available
      const header = guideHeaders.find((h) => h.agent === agent)?.value || ''

      return wrapContentWithBoundaryMarkers(content, agent, header)
    } catch (error) {
      throw new Error(
        `Failed to generate rule content for agent '${agent}' - type '${type}': ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  /**
   * Generates CLI mode content with full workflow and command reference.
   */
  private async generateCliContent(agent: Agent): Promise<string> {
    // Load section templates
    const workflow = await this.templateLoader.loadSection('workflow')
    const commandReference = await this.templateLoader.loadSection('command-reference')

    // Load base template
    const baseTemplate = await this.templateLoader.loadTemplate('base.md')

    // Assemble context for variable substitution
    const context = {
      /* eslint-disable camelcase */
      agent_name: agent,
      command_reference: commandReference,
      workflow,
      /* eslint-enable camelcase */
    }

    // Substitute variables and get content
    return this.templateLoader.substituteVariables(baseTemplate, context)
  }

  /**
   * Generates MCP mode content with concise tool-focused instructions.
   */
  private async generateMcpContent(): Promise<string> {
    // Load MCP-specific section
    const mcpWorkflow = await this.templateLoader.loadSection('mcp-workflow')

    // Load MCP base template
    const mcpBaseTemplate = await this.templateLoader.loadTemplate('mcp-base.md')

    // Assemble context for variable substitution
    const context = {
      /* eslint-disable camelcase */
      mcp_workflow: mcpWorkflow,
      /* eslint-enable camelcase */
    }

    // Substitute variables and get content
    return this.templateLoader.substituteVariables(mcpBaseTemplate, context)
  }
}
