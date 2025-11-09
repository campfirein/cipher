import type {Agent} from '../../core/domain/entities/agent.js'
import type {IFileService} from '../../core/interfaces/i-file-service.js'
import type {ILegacyRuleDetector} from '../../core/interfaces/i-legacy-rule-detector.js'
import type {IRuleTemplateService} from '../../core/interfaces/i-rule-template-service.js'
import type {IRuleWriterService} from '../../core/interfaces/i-rule-writer-service.js'

import {LegacyRulesDetectedError, RuleExistsError} from '../../core/domain/errors/rule-error.js'
import {AGENT_RULE_CONFIGS} from './agent-rule-config.js'
import {BRV_RULE_MARKERS, BRV_RULE_TAG} from './constants.js'
import {LegacyRuleDetector} from './legacy-rule-detector.js'

/**
 * Service for writing agent-specific rule files.
 * Uses IFileService to write files and RuleTemplateService to generate content.
 */
export class RuleWriterService implements IRuleWriterService {
  private readonly fileService: IFileService
  private readonly legacyRuleDetector: ILegacyRuleDetector
  private readonly templateService: IRuleTemplateService

  /**
   * Creates a new RuleWriterService.
   * @param fileService The file service to use for writing files.
   * @param templateService The template service to use for generating rule content.
   */
  public constructor(
    fileService: IFileService,
    templateService: IRuleTemplateService,
    legacyRuleDetector?: ILegacyRuleDetector,
  ) {
    this.fileService = fileService
    this.templateService = templateService
    this.legacyRuleDetector = legacyRuleDetector ?? new LegacyRuleDetector()
  }

  public async writeRule(agent: Agent, force: boolean): Promise<void> {
    const config = AGENT_RULE_CONFIGS[agent]
    if (!config) {
      throw new Error(`No configuration found for agent: ${agent}`)
    }

    const {filePath, writeMode} = config
    const fileExists = await this.fileService.exists(filePath)

    // Generate new rule content
    const ruleContent = await this.templateService.generateRuleContent(agent)

    // Handle overwrite mode (dedicated ByteRover files)
    if (writeMode === 'overwrite') {
      if (fileExists && !force) {
        throw new RuleExistsError()
      }

      await this.fileService.write(ruleContent, filePath, writeMode)
      return
    }

    // Handle append mode (shared instruction files)
    if (!fileExists) {
      // File doesn't exist - create it with new rules
      await this.fileService.write(ruleContent, filePath, writeMode)
      return
    }

    // File exists - check for boundary markers or legacy rules
    const content = await this.fileService.read(filePath)

    // Check for boundary markers (new format)
    if (content.includes(BRV_RULE_MARKERS.START) && content.includes(BRV_RULE_MARKERS.END)) {
      if (!force) {
        throw new RuleExistsError()
      }

      // Replace content between markers
      await this.replaceRulesWithinMarkers(content, ruleContent, filePath)
      return
    }

    // Check for legacy rules (old format without markers)
    if (content.includes(BRV_RULE_TAG)) {
      // Detect legacy rules and throw error with detection results
      const detectionResult = this.legacyRuleDetector.detectLegacyRules(content, agent)
      throw new LegacyRulesDetectedError(detectionResult, filePath)
    }

    // No existing ByteRover rules - append new rules
    await this.fileService.write(ruleContent, filePath, writeMode)
  }

  /**
   * Replaces ByteRover rules content between boundary markers.
   *
   * @param currentContent The current file content.
   * @param newRuleContent The new rule content (already wrapped with markers).
   * @param filePath The file path.
   */
  private async replaceRulesWithinMarkers(
    currentContent: string,
    newRuleContent: string,
    filePath: string,
  ): Promise<void> {
    const startIndex = currentContent.indexOf(BRV_RULE_MARKERS.START)
    const endIndex = currentContent.indexOf(BRV_RULE_MARKERS.END)

    if (startIndex === -1 || endIndex === -1) {
      throw new Error('Boundary markers not found in file content')
    }

    const endOfEndMarker = endIndex + BRV_RULE_MARKERS.END.length
    const oldSection = currentContent.slice(startIndex, endOfEndMarker)

    await this.fileService.replaceContent(filePath, oldSection, newRuleContent)
  }
}
