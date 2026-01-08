import {Command} from '@oclif/core'

import {FsFileService} from '../infra/file/fs-file-service.js'
import {FsTemplateLoader} from '../infra/template/fs-template-loader.js'

/**
 * Hidden command for Claude Code UserPromptSubmit hook.
 * Outputs ByteRover workflow instructions to stdout.
 * Claude Code wraps the output in <system-reminder> tags.
 *
 * Usage in .claude/settings.local.json:
 * {
 *   "hooks": {
 *     "UserPromptSubmit": [{
 *       "command": "brv hook-prompt-submit"
 *     }]
 *   }
 * }
 */
export default class HookPromptSubmit extends Command {
  static description = 'Internal: Claude Code UserPromptSubmit hook'
  static hidden = true

  public async run(): Promise<void> {
    try {
      const fileService = new FsFileService()
      const templateLoader = new FsTemplateLoader(fileService)
      const instructions = await templateLoader.loadSection('brv-instructions')

      // Output to stdout (Claude Code wraps in <system-reminder>)
      this.log(`<!-- ByteRover Context -->\n\n${instructions}`)
    } catch {
      // Silently fail - don't interrupt Claude Code workflow
      // Template might be missing in dev environment or corrupted
    }
  }
}
