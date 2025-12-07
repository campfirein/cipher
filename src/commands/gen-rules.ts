import {confirm, search, select} from '@inquirer/prompts'
import {Command, Flags} from '@oclif/core'

import type {Agent} from '../core/domain/entities/agent.js'
import type {IFileService, WriteMode} from '../core/interfaces/i-file-service.js'
import type {LegacyRuleMatch, UncertainMatch} from '../core/interfaces/i-legacy-rule-detector.js'
import type {IRuleTemplateService} from '../core/interfaces/i-rule-template-service.js'
import type {ITrackingService} from '../core/interfaces/i-tracking-service.js'

import {AGENT_VALUES} from '../core/domain/entities/agent.js'
import {FsFileService} from '../infra/file/fs-file-service.js'
import {AGENT_RULE_CONFIGS} from '../infra/rule/agent-rule-config.js'
import {BRV_RULE_MARKERS, BRV_RULE_TAG} from '../infra/rule/constants.js'
import {LegacyRuleDetector} from '../infra/rule/legacy-rule-detector.js'
import {RuleTemplateService} from '../infra/rule/rule-template-service.js'
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
  static override flags = {
    agent: Flags.string({
      char: 'a',
      description: 'Agent to generate rules for (optional, will prompt if not provided)',
    }),
  }

  protected createServices(): {
    fileService: IFileService
    legacyRuleDetector: LegacyRuleDetector
    templateService: IRuleTemplateService
    trackingService: ITrackingService
  } {
    const fileService = new FsFileService()
    const templateLoader = new FsTemplateLoader(fileService)
    const templateService = new RuleTemplateService(templateLoader)

    return {
      fileService,
      legacyRuleDetector: new LegacyRuleDetector(),
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
   * Prompts the user to create a new rule file.
   * This method is protected to allow test overrides.
   * @param agent The agent for which the rule file doesn't exist
   * @param filePath The path where the file would be created
   * @returns True if the user wants to create the file, false otherwise
   */
  protected async promptForFileCreation(agent: Agent, filePath: string): Promise<boolean> {
    return confirm({
      default: true,
      message: `Rule file '${filePath}' doesn't exist. Create it with ByteRover rules?`,
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
    const {fileService, legacyRuleDetector, templateService, trackingService} = this.createServices()
    await trackingService.track('rule:generate')

    const selectedAgent = await this.promptForAgentSelection()
    const {filePath, writeMode} = AGENT_RULE_CONFIGS[selectedAgent]

    this.log(`Generating rules for: ${selectedAgent}`)

    // STEP 1: Check if file exists
    const fileExists = await fileService.exists(filePath)

    if (!fileExists) {
      // Scenario A: File doesn't exist
      const shouldCreate = await this.promptForFileCreation(selectedAgent, filePath)
      if (!shouldCreate) {
        this.log(`Skipped rule file creation for ${selectedAgent}`)
        return
      }

      await this.createNewRuleFile({
        agent: selectedAgent,
        filePath,
        fileService,
        templateService,
      })
      return
    }

    // STEP 2: File exists - read content
    const content = await fileService.read(filePath)

    // STEP 3: Check for LEGACY rules (priority: clean these up first)
    const hasFooterTag = content.includes(`${BRV_RULE_TAG} ${selectedAgent}`)
    const hasBoundaryMarkers = content.includes(BRV_RULE_MARKERS.START) && content.includes(BRV_RULE_MARKERS.END)
    const hasLegacyRules = hasFooterTag && !hasBoundaryMarkers

    if (hasLegacyRules) {
      // Scenario B: Legacy rules detected - handle cleanup
      await this.handleLegacyRulesCleanup({
        agent: selectedAgent,
        content,
        filePath,
        fileService,
        legacyRuleDetector,
        templateService,
      })
      return
    }

    // STEP 4: Check for NEW rules (boundary markers)
    if (hasBoundaryMarkers) {
      // Scenario C: New rules exist - prompt for overwrite
      const shouldOverwrite = await this.promptForOverwriteConfirmation(selectedAgent)
      if (!shouldOverwrite) {
        this.log(`Skipped rule file update for ${selectedAgent}`)
        return
      }

      await this.replaceExistingRules({
        agent: selectedAgent,
        content,
        filePath,
        fileService,
        templateService,
        writeMode,
      })
      return
    }

    // STEP 5: No ByteRover content - append rules
    await this.appendRulesToFile({
      agent: selectedAgent,
      filePath,
      fileService,
      templateService,
      writeMode,
    })
  }

  /**
   * Appends ByteRover rules to a file that has no ByteRover content.
   */
  private async appendRulesToFile(params: {
    agent: Agent
    filePath: string
    fileService: IFileService
    templateService: IRuleTemplateService
    writeMode: WriteMode
  }): Promise<void> {
    const {agent, filePath, fileService, templateService, writeMode} = params
    const ruleContent = await templateService.generateRuleContent(agent)

    // For dedicated ByteRover files, overwrite; for shared instruction files, append
    const mode = writeMode === 'overwrite' ? 'overwrite' : 'append'
    await fileService.write(ruleContent, filePath, mode)

    this.log(`✅ Successfully added rule file for ${agent}`)
  }

  /**
   * Creates a new rule file with ByteRover rules.
   */
  private async createNewRuleFile(params: {
    agent: Agent
    filePath: string
    fileService: IFileService
    templateService: IRuleTemplateService
  }): Promise<void> {
    const {agent, filePath, fileService, templateService} = params
    const ruleContent = await templateService.generateRuleContent(agent)
    await fileService.write(ruleContent, filePath, 'overwrite')
    this.log(`✅ Successfully created rule file for ${agent} at ${filePath}`)
  }

  /**
   * Handles legacy rules cleanup with user choice of automatic or manual.
   */
  private async handleLegacyRulesCleanup(params: {
    agent: Agent
    content: string
    filePath: string
    fileService: IFileService
    legacyRuleDetector: LegacyRuleDetector
    templateService: IRuleTemplateService
  }): Promise<void> {
    const {agent, content, filePath, fileService, legacyRuleDetector, templateService} = params
    const detectionResult = legacyRuleDetector.detectLegacyRules(content, agent)
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

  /**
   * Replaces existing ByteRover rules (with boundary markers) with new rules.
   */
  private async replaceExistingRules(params: {
    agent: Agent
    content: string
    filePath: string
    fileService: IFileService
    templateService: IRuleTemplateService
    writeMode: WriteMode
  }): Promise<void> {
    const {agent, content, filePath, fileService, templateService, writeMode} = params
    const ruleContent = await templateService.generateRuleContent(agent)

    if (writeMode === 'overwrite') {
      // For dedicated ByteRover files, just overwrite the entire file
      await fileService.write(ruleContent, filePath, 'overwrite')
    } else {
      // For shared instruction files, replace the section between markers
      const startMarker = BRV_RULE_MARKERS.START
      const endMarker = BRV_RULE_MARKERS.END
      const startIndex = content.indexOf(startMarker)
      const endIndex = content.indexOf(endMarker, startIndex)

      if (startIndex === -1 || endIndex === -1) {
        this.error('Could not find boundary markers in the file')
      }

      const before = content.slice(0, startIndex)
      const after = content.slice(endIndex + endMarker.length)
      const newContent = before + ruleContent + after

      await fileService.write(newContent, filePath, 'overwrite')
    }

    this.log(`✅ Successfully updated rule file for ${agent}`)
  }
}
