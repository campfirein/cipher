import {Command, Flags} from '@oclif/core'

import {writeJsonResponse} from '../../lib/json-response.js'

/**
 * Tool-mode dream sessions are stateless on the daemon in v1, so cancel
 * is effectively a no-op — there's nothing to clean up server-side. The
 * command stays in the surface for symmetry; a future revision that
 * persists sessions can hook real cleanup here without re-shaping the
 * CLI.
 */
export default class DreamCancel extends Command {
  public static description = 'Discard a tool-mode dream session.'
public static examples = ['<%= config.bin %> <%= command.id %> --session drm-abc123']
public static flags = {
    format: Flags.string({default: 'text', description: 'Output format (text or json)', options: ['text', 'json']}),
    session: Flags.string({description: 'Session id to discard', required: true}),
  }

  public async run(): Promise<void> {
    const {flags: raw} = await this.parse(DreamCancel)
    const format = raw.format === 'json' ? 'json' : 'text'

    if (format === 'json') {
      writeJsonResponse({
        command: 'dream-cancel',
        data: {sessionId: raw.session, status: 'cancelled'},
        success: true,
      })
    } else {
      this.log(`Session ${raw.session} discarded.`)
      this.log('')
      this.log('(Tool-mode dream sessions are stateless on the daemon in v1;')
      this.log('cancel is a no-op. Any brv-curate writes made between scan and')
      this.log('cancel are NOT rolled back — use `brv dream undo` for that.)')
    }
  }
}
