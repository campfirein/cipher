import {Command} from '@oclif/core'

export default class HubRegistry extends Command {
  public static description = 'Manage hub registries'

  public async run(): Promise<void> {
    await this.config.runCommand('hub:registry:list', this.argv)
  }
}
