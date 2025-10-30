import {confirm, search} from '@inquirer/prompts'
import {Command} from '@oclif/core'

import {type Agent, AGENT_VALUES} from '../core/domain/entities/agent.js'
import {RuleExistsError} from '../core/domain/errors/rule-error.js'
import {type IRuleWriterService} from '../core/interfaces/i-rule-writer-service.js'
import {FsFileService} from '../infra/file/fs-file-service.js'
import {RuleTemplateService} from '../infra/rule/rule-template-service.js'
import {RuleWriterService} from '../infra/rule/rule-writer-service.js'
import {FsTemplateLoader} from '../infra/template/fs-template-loader.js'

/**
 * Array of all agents with name and value properties.
 * Useful for UI components like select dropdowns.
 */
const AGENTS = AGENT_VALUES.map((agent) => ({
  name: agent,
  value: agent,
}))

export default class GenRules extends Command {
  static override description = 'Generate rule instructions for coding agents to work with ByteRover correctly'
  static override examples = ['<%= config.bin %> <%= command.id %>']

  protected createServices(): {
    ruleWriterService: IRuleWriterService
  } {
    const fileService = new FsFileService()
    const templateLoader = new FsTemplateLoader(fileService)
    const templateService = new RuleTemplateService(templateLoader)

    return {
      ruleWriterService: new RuleWriterService(fileService, templateService),
    }
  }

  /**
   * Prompts the user to select an agent.
   * This method is protected to allow test overrides.
   * @returns The selected agent
   */
  protected async promptForAgentSelection(): Promise<Agent> {
    const answer = await search({
      message: 'Which agent you are using (type to search):',
      async source(input) {
        if (!input) return AGENTS

        return AGENTS.filter(
          (agent) =>
            agent.name.toLowerCase().includes(input.toLowerCase()) ||
            agent.value.toLowerCase().includes(input.toLowerCase()),
        )
      },
    })

    return answer
  }

  /**
   * Prompts the user to confirm overwriting an existing rule file.
   * This method is protected to allow test overrides.
   * @param agent The agent for which the rule file exists
   * @returns True if the user confirms overwrite, false otherwise
   */
  protected async promptForOverwriteConfirmation(agent: Agent): Promise<boolean> {
    return confirm({
      default: true,
      message: `Rule file already exists for ${agent}. Overwrite?`,
    })
  }

  public async run(): Promise<void> {
    const {ruleWriterService} = this.createServices()

    // Interactive selection with search
    const answer = await this.promptForAgentSelection()

    this.log(`Generating rules for: ${answer}`)

    try {
      await ruleWriterService.writeRule(answer, false)
      this.log(`✅ Successfully generated rule file for ${answer}`)
    } catch (error) {
      if (error instanceof RuleExistsError) {
        const overwrite = await this.promptForOverwriteConfirmation(answer)

        if (overwrite) {
          // Retry with forced=true
          await ruleWriterService.writeRule(answer, true)
          this.log(`✅ Successfully generated rule file for ${answer}`)
        } else {
          this.log(`Skipping rule file generation for ${answer}`)
        }
      } else {
        // Non-recoverable error
        this.error(`Failed to generate rule file: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
}
