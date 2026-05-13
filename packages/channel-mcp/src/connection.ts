import {ChannelClient} from '@brv/channel-client'

// Lazy-init shared ChannelClient for the MCP server process. All four
// tools call `getSharedClient()`; the daemon's socket is precious so we
// only open it once per server lifetime. `closeSharedClient()` is hooked
// on SIGINT / SIGTERM by server.ts.

export type ConnectionOptions = {
  /** Override the daemon `cwd` query param. Default: `process.cwd()`. */
  readonly cwd?: string
}

let sharedClient: ChannelClient | undefined
let inFlightConnect: Promise<ChannelClient> | undefined

export const getSharedClient = async (options: ConnectionOptions = {}): Promise<ChannelClient> => {
  if (sharedClient !== undefined && sharedClient.connected) return sharedClient
  if (inFlightConnect !== undefined) return inFlightConnect

  inFlightConnect = (async () => {
    const client = await ChannelClient.connect({cwd: options.cwd})
    sharedClient = client
    inFlightConnect = undefined
    return client
  })()
  return inFlightConnect
}

export const closeSharedClient = async (): Promise<void> => {
  const c = sharedClient
  sharedClient = undefined
  if (c !== undefined) await c.close()
}
