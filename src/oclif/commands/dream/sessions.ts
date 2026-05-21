import {Command, Flags} from '@oclif/core'

import {writeJsonResponse} from '../../lib/json-response.js'

/**
 * Tool-mode dream sessions are stateless on the daemon in v1 — the agent
 * holds session state between scan and finalize. This command exists for
 * surface symmetry with the proposal and to give us a place to hang a
 * persistent session listing in a follow-up.
 */
export default class DreamSessions extends Command {
  public static description = 'List active tool-mode dream sessions.'
public static examples = [
    '# Plain text',
    '<%= config.bin %> <%= command.id %>',
    '',
    '# JSON for scripting',
    '<%= config.bin %> <%= command.id %> --format json',
  ]
public static flags = {
    format: Flags.string({default: 'text', description: 'Output format (text or json)', options: ['text', 'json']}),
  }

  public async run(): Promise<void> {
    const {flags: raw} = await this.parse(DreamSessions)
    const format = raw.format === 'json' ? 'json' : 'text'

    if (format === 'json') {
      writeJsonResponse({command: 'dream-sessions', data: {sessions: [], status: 'ok'}, success: true})
    } else {
      this.log(
        'No active sessions.\n\n' +
          '(Tool-mode dream sessions are stateless on the daemon in v1 — the\n' +
          'agent holds the session id between `brv dream scan` and\n' +
          '`brv dream finalize`.)',
      )
    }
  }
}
