import {confirm, search, select} from '@inquirer/prompts'
import {Command} from '@oclif/core'

import type {Agent} from '../core/domain/entities/agent.js'
import type {IFileService} from '../core/interfaces/i-file-service.js'
import type {LegacyRuleMatch, UncertainMatch} from '../core/interfaces/i-legacy-rule-detector.js'
import type {IRuleWriterService} from '../core/interfaces/i-rule-writer-service.js'
import type {ITrackingService} from '../core/interfaces/i-tracking-service.js'

import {AGENT_VALUES} from '../core/domain/entities/agent.js'
import {LegacyRulesDetectedError, RuleExistsError} from '../core/domain/errors/rule-error.js'
import {IRuleTemplateService} from '../core/interfaces/i-rule-template-service.js'
import {FsFileService} from '../infra/file/fs-file-service.js'
import {RuleTemplateService} from '../infra/rule/rule-template-service.js'
import {RuleWriterService} from '../infra/rule/rule-writer-service.js'
import {KeychainTokenStore} from '../infra/storage/keychain-token-store.js'
import {FsTemplateLoader} from '../infra/template/fs-template-loader.js'
import {MixpanelTrackingService} from '../infra/tracking/mixpanel-tracking-service.js'

type CleanupStrategy = 'automatic' | 'manual'

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
    fileService: IFileService
    ruleWriterService: IRuleWriterService
    templateService: IRuleTemplateService
    trackingService: ITrackingService
  } {
    const fileService = new FsFileService()
    const templateLoader = new FsTemplateLoader(fileService)
    const templateService = new RuleTemplateService(templateLoader)

    return {
      fileService,
      ruleWriterService: new RuleWriterService(fileService, templateService),
      templateService,
      trackingService: new MixpanelTrackingService(new KeychainTokenStore()),
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
   * Prompts the user to choose cleanup strategy for legacy rules.
   * This method is protected to allow test overrides.
   * @returns The chosen cleanup strategy
   */
  protected async promptForCleanupStrategy(): Promise<CleanupStrategy> {
    return select({
      choices: [
        {
          description:
            'New rules will be added with boundary markers. You manually remove old sections at your convenience.',
          name: 'Manual cleanup (recommended)',
          value: 'manual' as CleanupStrategy,
        },
        {
          description:
            '⚠️  We will remove all detected old sections. May cause content loss if detection is imperfect. A backup will be created.',
          name: 'Automatic cleanup',
          value: 'automatic' as CleanupStrategy,
        },
      ],
      message: 'How would you like to proceed?',
    })
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
    const {fileService, ruleWriterService, templateService, trackingService} = this.createServices()
    await trackingService.track('rule:generate')
    const selectedAgent = await this.promptForAgentSelection()
    this.log(`Generating rules for: ${selectedAgent}`)
    try {
      await ruleWriterService.writeRule(selectedAgent, false)
      this.log(`✅ Successfully generated rule file for ${selectedAgent}`)
    } catch (error) {
      if (error instanceof LegacyRulesDetectedError) {
        await this.handleLegacyRulesDetectedError({
          agent: selectedAgent,
          error,
          fileService,
          ruleWriterService,
          templateService,
        })
      } else if (error instanceof RuleExistsError) {
        const overwrite = await this.promptForOverwriteConfirmation(selectedAgent)

        if (overwrite) {
          // Retry with forced=true
          await ruleWriterService.writeRule(selectedAgent, true)
          this.log(`✅ Successfully generated rule file for ${selectedAgent}`)
        } else {
          this.log(`Skipping rule file generation for ${selectedAgent}`)
        }
      } else {
        // Non-recoverable error
        this.error(`Failed to generate rule file: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  private async handleLegacyRulesDetectedError(params: {
    agent: Agent
    error: LegacyRulesDetectedError
    fileService: IFileService
    ruleWriterService: IRuleWriterService
    templateService: IRuleTemplateService
  }): Promise<void> {
    const {agent, error, fileService, templateService} = params
    const {detectionResult, filePath} = error
    const {reliableMatches, uncertainMatches} = detectionResult
    this.log(
      `\n⚠️  Detected ${
        reliableMatches.length + uncertainMatches.length
      } old ByteRover rule section(s) in ${filePath}:\n`,
    )
    if (reliableMatches.length > 0) {
      this.log('Reliable matches:')
      for (const [index, match] of reliableMatches.entries()) {
        this.log(`  Section ${index + 1}: lines ${match.startLine}-${match.endLine}`)
      }

      this.log()
    }

    if (uncertainMatches.length > 0) {
      this.log('  ⚠️  Uncertain matches (cannot determine start):')
      for (const match of uncertainMatches) {
        this.log(`  Footer found at line ${match.footerLine}`)
        this.log(`  Reason: ${match.reason}`)
      }

      this.log()
      this.log('⚠️  Due to uncertain matches, only manual cleanup is available.\n')
      await this.performManualCleanup({
        agent,
        filePath,
        fileService,
        reliableMatches,
        templateService,
        uncertainMatches,
      })
      return
    }

    const selectedStrategy = await this.promptForCleanupStrategy()
    await (selectedStrategy === 'manual'
      ? this.performManualCleanup({
          agent,
          filePath,
          fileService,
          reliableMatches,
          templateService,
          uncertainMatches,
        })
      : this.performAutomaticCleanup({
          agent,
          filePath,
          fileService,
          reliableMatches,
          templateService,
        }))
  }

  private async performAutomaticCleanup(params: {
    agent: Agent
    filePath: string
    fileService: IFileService
    reliableMatches: LegacyRuleMatch[]
    templateService: IRuleTemplateService
  }): Promise<void> {
    const {agent, filePath, fileService, reliableMatches, templateService} = params
    const backupPath = await fileService.createBackup(filePath)
    this.log(`📦 Backup created: ${backupPath}`)
    let content = await fileService.read(filePath)
    // Remove all reliable matches (in reverse order to preserve line numbers)
    const sortedMatches = [...reliableMatches].sort((a, b) => b.startLine - a.startLine)
    for (const match of sortedMatches) {
      content = content.replace(match.content, '')
    }

    // Write cleaned content
    await fileService.write(content, filePath, 'overwrite')
    // Append new rules
    const ruleContent = await templateService.generateRuleContent(agent)
    await fileService.write(ruleContent, filePath, 'append')
    this.log(`✅ Removed ${reliableMatches.length} old ByteRover section(s)`)
    this.log(`✅ Added new rules with boundary markers`)
    this.log(`\nYou can safely delete the backup file once verified.`)
  }

  private async performManualCleanup(params: {
    agent: Agent
    filePath: string
    fileService: IFileService
    reliableMatches: LegacyRuleMatch[]
    templateService: IRuleTemplateService
    uncertainMatches: UncertainMatch[]
  }): Promise<void> {
    const {agent, filePath, fileService, reliableMatches, templateService, uncertainMatches} = params
    const ruleContent = await templateService.generateRuleContent(agent)
    await fileService.write(ruleContent, filePath, 'append')
    this.log(`✅ New ByteRover rules added with boundary markers\n`)
    this.log('Please manually remove old sections:')
    for (const [index, match] of reliableMatches.entries()) {
      this.log(`  - Section ${index + 1}: lines ${match.startLine}-${match.endLine} in ${filePath}`)
    }

    for (const match of uncertainMatches) {
      this.log(`  - Section ending at line ${match.footerLine} in ${filePath}`)
    }

    this.log('\nKeep only the section between:')
    this.log('  <!-- BEGIN BYTEROVER RULES -->')
    this.log('  <!-- END BYTEROVER RULES -->')
  }
}
