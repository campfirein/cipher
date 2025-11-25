import {Command} from '@oclif/core'

export default class Main extends Command {
  public static description = 'ByteRover CLI'
  /**
   *  Hide from help listing since this is the default command (only 'brv')
   */
  public static hidden = true

  public async run(): Promise<void> {
    this.log('brv executed')
  }
}
