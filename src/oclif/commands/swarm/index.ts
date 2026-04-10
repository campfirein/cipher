import {Command} from '@oclif/core'

export default class Swarm extends Command {
  public static description = 'Multi-agent swarm orchestration'
  public static examples = ['<%= config.bin %> <%= command.id %> --help']

  public async run(): Promise<void> {
    await this.config.runCommand('help', ['swarm'])
  }
}
