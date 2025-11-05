import {type Agent} from '../../core/domain/entities/agent.js'
import {type IRuleTemplateService} from '../../core/interfaces/i-rule-template-service.js'
import {type ITemplateLoader} from '../../core/interfaces/i-template-loader.js'
import {BR_RULE_TAG} from './constants.js'

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
  public async generateRuleContent(agent: Agent): Promise<string> {
    try {
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
      const content = this.templateLoader.substituteVariables(baseTemplate, context)

      // Add agent-specific header if available (from develop branch)
      const header = guideHeaders.find((h) => h.agent === agent)?.value || ''

      return `${header}
${content}
---
${BR_RULE_TAG} ${agent}
`
    } catch (error) {
      throw new Error(
        `Failed to generate rule content for agent '${agent}': ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }
}
