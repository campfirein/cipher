import {Command} from '@oclif/core'

export default class Hub extends Command {
  public static description = 'Browse and manage skills & bundles registry'

  public async run(): Promise<void> {
    await this.config.runCommand('hub:list', this.argv)
  }
}
