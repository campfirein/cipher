import open from 'open'

import type {IBrowserLauncher} from '../../core/interfaces/services/i-browser-launcher.js'

/**
 * Browser launcher implementation that opens URLs in the system's default browser.
 */
export class SystemBrowserLauncher implements IBrowserLauncher {
  private readonly openFn: typeof open

  public constructor(openFn: typeof open = open) {
    this.openFn = openFn
  }

  public async open(url: string): Promise<void> {
    try {
      await this.openFn(url)
    } catch (error) {
      throw new Error(`Failed to launch browser: ${error}`)
    }
  }
}
