import {Command} from '@oclif/core'

export default class Vc extends Command {
  public static description = 'Version control commands for the context tree'
  public static examples = ['<%= config.bin %> <%= command.id %> --help']

  public async run(): Promise<void> {
    await this.config.runCommand('help', ['vc'])
  }
}
