import {Command} from '@oclif/core'

import {isDevelopment} from '../config/environment.js'
import {ITemplateLoader} from '../core/interfaces/i-template-loader.js'
import {FsFileService} from '../infra/file/fs-file-service.js'
import {FsTemplateLoader} from '../infra/template/fs-template-loader.js'

/**
 * Dependencies required by HookPromptSubmit command.
 * Exported for test mocking.
 */
export type HookPromptSubmitDependencies = {
  templateLoader: ITemplateLoader
}

/**
 * Hidden command for coding agent pre-prompt hooks.
 * Outputs ByteRover workflow instructions to stdout.
 * The agent wraps the output in system context (e.g., <system-reminder> tags).
 *
 * Supported agents:
 * - Claude Code: .claude/settings.local.json (UserPromptSubmit)
 */
export default class HookPromptSubmit extends Command {
  static description = 'Internal: Pre-prompt hook for coding agents'
  static hidden = true

  /**
   * Factory method for creating dependencies.
   * Override in tests to inject mock dependencies.
   */
  protected createDependencies(): HookPromptSubmitDependencies {
    const fileService = new FsFileService()
    const templateLoader = new FsTemplateLoader(fileService)
    return {templateLoader}
  }

  public async run(): Promise<void> {
    try {
      const {templateLoader} = this.createDependencies()
      const instructions = await templateLoader.loadSection('brv-instructions')

      // Output to stdout (agent wraps in system context)
      this.log(instructions)
    } catch (error) {
      // Silently fail in production - don't interrupt agent workflow
      if (isDevelopment()) {
        console.error('[hook-prompt-submit] Template load failed:', error)
      }
    }
  }
}
