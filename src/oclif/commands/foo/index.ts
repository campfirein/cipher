import {Command} from '@oclif/core'

export default class Foo extends Command {
  public static description = 'Git semantics commands (internal demo)'

  public async run(): Promise<void> {
    if (this.argv.length === 0) {
      await this.config.runCommand('help', ['foo'])
      return
    }

    await this.config.runCommand('foo:init', this.argv)
  }
}
