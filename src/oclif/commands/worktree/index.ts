import {Command} from '@oclif/core'

export default class Worktree extends Command {
  public static description = 'Manage worktree links (.brv-worktree.json) for nested directories'
  public static examples = ['<%= config.bin %> <%= command.id %> --help']

  public async run(): Promise<void> {
    await this.config.runCommand('help', ['worktree'])
  }
}
