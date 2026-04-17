import {Command} from '@oclif/core'

export default class Source extends Command {
  public static description = 'Manage knowledge sources (read-only references to other projects)'
  public static examples = ['<%= config.bin %> <%= command.id %> --help']

  public async run(): Promise<void> {
    await this.config.runCommand('help', ['source'])
  }
}
