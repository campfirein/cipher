import type {CallbackResult, ICallbackHandler} from '../../core/interfaces/auth/i-callback-handler.js'

import {CallbackServer} from './callback-server.js'

/**
 * Adapter implementation of ICallbackHandler that wraps CallbackServer.
 * Provides OAuth callback handling functionality through a local HTTP server.
 */
export class CallbackHandler implements ICallbackHandler {
  private readonly server: CallbackServer

  public constructor() {
    this.server = new CallbackServer()
  }

  public getPort(): number | undefined {
    const address = this.server.getAddress()
    return address?.port
  }

  public async start(): Promise<number> {
    return this.server.start()
  }

  public async stop(): Promise<void> {
    return this.server.stop()
  }

  public async waitForCallback(expectedState: string, timeoutMs: number): Promise<CallbackResult> {
    return this.server.waitForCallback(expectedState, timeoutMs)
  }
}
