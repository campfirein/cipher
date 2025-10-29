import {type Agent} from '../../core/domain/entities/agent.js'
import {RuleExistsError} from '../../core/domain/errors/rule-error.js'
import {type IFileService} from '../../core/interfaces/i-file-service.js'
import {BR_RULE_TAG, IRuleTemplateService} from '../../core/interfaces/i-rule-template-service.js'
import {type IRuleWriterService} from '../../core/interfaces/i-rule-writer-service.js'
import {AGENT_RULE_CONFIGS} from './agent-rule-config.js'

/**
 * Service for writing agent-specific rule files.
 * Uses IFileService to write files and RuleTemplateService to generate content.
 */
export class RuleWriterService implements IRuleWriterService {
  private readonly fileService: IFileService
  private readonly templateService: IRuleTemplateService

  /**
   * Creates a new RuleWriterService.
   * @param fileService The file service to use for writing files.
   * @param templateService The template service to use for generating rule content.
   */
  constructor(fileService: IFileService, templateService: IRuleTemplateService) {
    this.fileService = fileService
    this.templateService = templateService
  }

  /**
   * Writes a rule file for the specified agent.
   * @param agent The agent for which to write the rule.
   * @returns A promise that resolves when the rule has been written.
   * @throws Error if the agent is not supported or if writing fails.
   */
  public async writeRule(agent: Agent, force: boolean): Promise<void> {
    const config = AGENT_RULE_CONFIGS[agent]
    if (!config) {
      throw new Error(`No configuration found for agent: ${agent}`)
    }

    const {filePath, writeMode} = config

    const fileExists = await this.fileService.exists(filePath)

    // Throw an error if the file exists and force is not set
    if (writeMode === 'overwrite' && fileExists && !force) {
      throw new RuleExistsError()
    }

    if (writeMode === 'append' && fileExists && !force) {
      const content = await this.fileService.read(filePath)
      // Throw an error if the rule already exists
      if (content.includes(BR_RULE_TAG)) {
        throw new RuleExistsError()
      }
    }

    // Generate rule content
    const ruleContent = this.templateService.generateRuleContent(agent)

    // Write the rule file
    await this.fileService.write(ruleContent, filePath, writeMode)
  }
}
