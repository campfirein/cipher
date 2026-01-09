import type {Agent} from '../../core/domain/entities/agent.js'
import type {IHookManager} from '../../core/interfaces/hooks/i-hook-manager.js'
import type {IFileService, WriteMode} from '../../core/interfaces/i-file-service.js'
import type {LegacyRuleMatch, UncertainMatch} from '../../core/interfaces/i-legacy-rule-detector.js'
import type {IRuleTemplateService} from '../../core/interfaces/i-rule-template-service.js'
import type {ITerminal} from '../../core/interfaces/i-terminal.js'
import type {ITrackingService} from '../../core/interfaces/i-tracking-service.js'
import type {IGenerateRulesUseCase} from '../../core/interfaces/usecase/i-generate-rules-use-case.js'

import {AGENT_VALUES} from '../../core/domain/entities/agent.js'
import {tryInstallHookWithRestartMessage} from '../hooks/hook-install-helper.js'
import {AGENT_RULE_CONFIGS} from '../rule/agent-rule-config.js'
import {BRV_RULE_MARKERS, BRV_RULE_TAG} from '../rule/constants.js'
import {LegacyRuleDetector} from '../rule/legacy-rule-detector.js'

type CleanupStrategy = 'automatic' | 'manual'

/**
 * Array of all agents with name and value properties.
 * Useful for UI components like select dropdowns.
 */
const AGENTS = AGENT_VALUES.map((agent) => ({
  name: agent,
  value: agent,
}))

export class GenerateRulesUseCase implements IGenerateRulesUseCase {
  // eslint-disable-next-line max-params
  constructor(
    private readonly fileService: IFileService,
    private readonly legacyRuleDetector: LegacyRuleDetector,
    private readonly templateService: IRuleTemplateService,
    private readonly terminal: ITerminal,
    private readonly trackingService: ITrackingService,
    private readonly hookManager?: IHookManager,
  ) {}

  /**
   * Prompts the user to select an agent.
   * @returns The selected agent
   */
  protected async promptForAgentSelection(): Promise<Agent> {
    return this.terminal.search({
      message: 'Which agent you are using (type to search):',
      source(input) {
        if (!input) return AGENTS
        return AGENTS.filter(
          (agent) =>
            agent.name.toLowerCase().includes(input.toLowerCase()) ||
            agent.value.toLowerCase().includes(input.toLowerCase()),
        )
      },
    })
  }

  /**
   * Prompts the user to choose cleanup strategy for legacy rules.
   * @returns The chosen cleanup strategy
   */
  protected async promptForCleanupStrategy(): Promise<CleanupStrategy> {
    return this.terminal.select({
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
    return this.terminal.confirm({
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
    return this.terminal.confirm({
      default: true,
      message: `Rule file already exists for ${agent}. Overwrite?`,
    })
  }

  public async run(): Promise<void> {
    await this.trackingService.track('rule:generate')

    const selectedAgent = await this.promptForAgentSelection()
    const {filePath, writeMode} = AGENT_RULE_CONFIGS[selectedAgent]

    this.terminal.log(`Generating rules for: ${selectedAgent}`)

    // STEP 1: Check if file exists
    const fileExists = await this.fileService.exists(filePath)

    if (!fileExists) {
      // Scenario A: File doesn't exist
      const shouldCreate = await this.promptForFileCreation(selectedAgent, filePath)
      if (!shouldCreate) {
        this.terminal.log(`Skipped rule file creation for ${selectedAgent}`)
        return
      }

      await this.createNewRuleFile({
        agent: selectedAgent,
        filePath,
        fileService: this.fileService,
        templateService: this.templateService,
      })
      return
    }

    // STEP 2: File exists - read content
    const content = await this.fileService.read(filePath)

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
        fileService: this.fileService,
        legacyRuleDetector: this.legacyRuleDetector,
        templateService: this.templateService,
      })
      return
    }

    // STEP 4: Check for NEW rules (boundary markers)
    if (hasBoundaryMarkers) {
      // Scenario C: New rules exist - prompt for overwrite
      const shouldOverwrite = await this.promptForOverwriteConfirmation(selectedAgent)
      if (!shouldOverwrite) {
        this.terminal.log(`Skipped rule file update for ${selectedAgent}`)
        return
      }

      await this.replaceExistingRules({
        agent: selectedAgent,
        content,
        filePath,
        fileService: this.fileService,
        templateService: this.templateService,
        writeMode,
      })
      return
    }

    // STEP 5: No ByteRover content - append rules
    await this.appendRulesToFile({
      agent: selectedAgent,
      filePath,
      fileService: this.fileService,
      templateService: this.templateService,
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

    this.terminal.log(`✅ Successfully added rule file for ${agent}`)
    await tryInstallHookWithRestartMessage({agent, hookManager: this.hookManager, terminal: this.terminal})
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
    this.terminal.log(`✅ Successfully created rule file for ${agent} at ${filePath}`)
    await tryInstallHookWithRestartMessage({agent, hookManager: this.hookManager, terminal: this.terminal})
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

    this.terminal.log(
      `\n⚠️  Detected ${
        reliableMatches.length + uncertainMatches.length
      } old ByteRover rule section(s) in ${filePath}:\n`,
    )

    if (reliableMatches.length > 0) {
      this.terminal.log('Reliable matches:')
      for (const [index, match] of reliableMatches.entries()) {
        this.terminal.log(`  Section ${index + 1}: lines ${match.startLine}-${match.endLine}`)
      }

      this.terminal.log('')
    }

    if (uncertainMatches.length > 0) {
      this.terminal.log('  ⚠️  Uncertain matches (cannot determine start):')
      for (const match of uncertainMatches) {
        this.terminal.log(`  Footer found at line ${match.footerLine}`)
        this.terminal.log(`  Reason: ${match.reason}`)
      }

      this.terminal.log('\n⚠️  Due to uncertain matches, only manual cleanup is available.\n')
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
    this.terminal.log(`📦 Backup created: ${backupPath}`)
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
    this.terminal.log(`✅ Removed ${reliableMatches.length} old ByteRover section(s)`)
    this.terminal.log(`✅ Added new rules with boundary markers`)
    this.terminal.log(`\nYou can safely delete the backup file once verified.`)
    await tryInstallHookWithRestartMessage({agent, hookManager: this.hookManager, terminal: this.terminal})
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
    this.terminal.log(`✅ New ByteRover rules added with boundary markers\n`)
    this.terminal.log('Please manually remove old sections:')
    for (const [index, match] of reliableMatches.entries()) {
      this.terminal.log(`  - Section ${index + 1}: lines ${match.startLine}-${match.endLine} in ${filePath}`)
    }

    for (const match of uncertainMatches) {
      this.terminal.log(`  - Section ending at line ${match.footerLine} in ${filePath}`)
    }

    this.terminal.log('\nKeep only the section between:')
    this.terminal.log('  <!-- BEGIN BYTEROVER RULES -->')
    this.terminal.log('  <!-- END BYTEROVER RULES -->')
    await tryInstallHookWithRestartMessage({agent, hookManager: this.hookManager, terminal: this.terminal})
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
        this.terminal.error('Could not find boundary markers in the file')
      }

      const before = content.slice(0, startIndex)
      const after = content.slice(endIndex + endMarker.length)
      const newContent = before + ruleContent + after

      await fileService.write(newContent, filePath, 'overwrite')
    }

    this.terminal.log(`✅ Successfully updated rule file for ${agent}`)
    await tryInstallHookWithRestartMessage({agent, hookManager: this.hookManager, terminal: this.terminal})
  }
}
