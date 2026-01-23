import path from 'node:path'

import type {IFileService, WriteMode} from '../../../core/interfaces/i-file-service.js'

import {BRV_RULE_MARKERS, BRV_RULE_TAG} from './constants.js'

/**
 * Result of a rule file installation operation.
 */
export type RuleFileInstallResult = {
  /** Whether the content was newly installed (false if replaced existing) */
  isNew: boolean
  /** Whether the operation succeeded */
  success: boolean
}

/**
 * Result of a rule file uninstallation operation.
 */
export type RuleFileUninstallResult = {
  /** Whether the operation succeeded */
  success: boolean
  /** Whether there was content to remove */
  wasInstalled: boolean
}

/**
 * Result of a rule file status check.
 */
export type RuleFileStatusResult = {
  /** Whether the file exists */
  fileExists: boolean
  /** Whether the file contains legacy BRV tag (without markers) */
  hasLegacyTag: boolean
  /** Whether the file contains BRV markers */
  hasMarkers: boolean
}

/**
 * Manages rule file operations including installation, uninstallation,
 * and marker section manipulation.
 *
 * This class centralizes the logic for working with rule files that use
 * BRV markers to delimit managed content sections.
 */
export class RuleFileManager {
  private readonly fileService: IFileService
  private readonly projectRoot: string

  constructor(options: {fileService: IFileService; projectRoot: string}) {
    this.fileService = options.fileService
    this.projectRoot = options.projectRoot
  }

  /**
   * Install rule content into a file.
   *
   * @param filePath - Relative path to the rule file
   * @param writeMode - How to write the content ('overwrite' or 'append')
   * @param ruleContent - The rule content to write (should include markers)
   */
  async install(filePath: string, writeMode: WriteMode, ruleContent: string): Promise<RuleFileInstallResult> {
    const fullPath = path.join(this.projectRoot, filePath)
    const exists = await this.fileService.exists(fullPath)

    if (exists) {
      const content = await this.fileService.read(fullPath)
      const hasMarkers = content.includes(BRV_RULE_MARKERS.START) && content.includes(BRV_RULE_MARKERS.END)

      if (writeMode === 'overwrite') {
        await this.fileService.write(ruleContent, fullPath, 'overwrite')
      } else if (hasMarkers) {
        // Replace existing markers section
        const newContent = this.replaceMarkerSection(content, ruleContent)
        await this.fileService.write(newContent, fullPath, 'overwrite')
      } else {
        // Append to file
        await this.fileService.write(ruleContent, fullPath, 'append')
      }

      return {isNew: !hasMarkers, success: true}
    }

    // File doesn't exist - create it
    await this.fileService.write(ruleContent, fullPath, 'overwrite')
    return {isNew: true, success: true}
  }

  /**
   * Removes the section between BRV markers (inclusive).
   */
  removeMarkerSection(content: string): string {
    const startIndex = content.indexOf(BRV_RULE_MARKERS.START)
    const endIndex = content.indexOf(BRV_RULE_MARKERS.END)

    if (startIndex === -1 || endIndex === -1) {
      return content
    }

    const before = content.slice(0, startIndex)
    const after = content.slice(endIndex + BRV_RULE_MARKERS.END.length)

    // Clean up extra newlines
    return (before + after).replaceAll(/\n{3,}/g, '\n\n').trim()
  }

  /**
   * Replaces the section between BRV markers with new content.
   */
  replaceMarkerSection(content: string, newRuleContent: string): string {
    const startIndex = content.indexOf(BRV_RULE_MARKERS.START)
    const endIndex = content.indexOf(BRV_RULE_MARKERS.END)

    if (startIndex === -1 || endIndex === -1) {
      return content
    }

    const before = content.slice(0, startIndex)
    const after = content.slice(endIndex + BRV_RULE_MARKERS.END.length)

    return before + newRuleContent + after
  }

  /**
   * Check the status of rule content in a file.
   */
  async status(filePath: string): Promise<RuleFileStatusResult> {
    const fullPath = path.join(this.projectRoot, filePath)
    const fileExists = await this.fileService.exists(fullPath)

    if (!fileExists) {
      return {fileExists: false, hasLegacyTag: false, hasMarkers: false}
    }

    const content = await this.fileService.read(fullPath)
    const hasMarkers = content.includes(BRV_RULE_MARKERS.START) && content.includes(BRV_RULE_MARKERS.END)
    const hasLegacyTag = content.includes(BRV_RULE_TAG)

    return {fileExists: true, hasLegacyTag, hasMarkers}
  }

  /**
   * Uninstall rule content from a file.
   *
   * @param filePath - Relative path to the rule file
   * @param writeMode - How the content was written ('overwrite' or 'append')
   */
  async uninstall(filePath: string, writeMode: WriteMode): Promise<RuleFileUninstallResult> {
    const fullPath = path.join(this.projectRoot, filePath)
    const exists = await this.fileService.exists(fullPath)

    if (!exists) {
      return {success: true, wasInstalled: false}
    }

    const content = await this.fileService.read(fullPath)
    const hasMarkers = content.includes(BRV_RULE_MARKERS.START) && content.includes(BRV_RULE_MARKERS.END)

    if (!hasMarkers) {
      return {success: true, wasInstalled: false}
    }

    if (writeMode === 'overwrite') {
      // For dedicated files, delete the entire file
      await this.fileService.delete(fullPath)
    } else {
      // For shared files, remove only the BRV section
      const newContent = this.removeMarkerSection(content)

      await (newContent.trim() === ''
        ? this.fileService.delete(fullPath)
        : this.fileService.write(newContent, fullPath, 'overwrite'))
    }

    return {success: true, wasInstalled: true}
  }
}
