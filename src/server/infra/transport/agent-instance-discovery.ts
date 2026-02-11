import type {DiscoveryResult, IInstanceDiscovery} from '@campfirein/brv-transport-client'

import {InstanceInfo} from '@campfirein/brv-transport-client'

/**
 * Agent-specific instance discovery.
 *
 * Unlike DaemonInstanceDiscovery which scans global daemon.json,
 * this returns a fixed instance using port passed by parent via env var.
 *
 * Used by agent child processes that are forked by the daemon and
 * need to connect back to their specific parent daemon instance.
 */
export class AgentInstanceDiscovery implements IInstanceDiscovery {
  private readonly port: number
  private readonly projectPath: string

  constructor(options: {port: number; projectPath: string}) {
    this.port = options.port
    this.projectPath = options.projectPath
  }

  async discover(): Promise<DiscoveryResult> {
    // Return fixed instance from env var - no scanning needed
    return {
      found: true,
      instance: InstanceInfo.create({
        pid: process.ppid ?? -1, // Parent daemon PID
        port: this.port,
      }),
      projectRoot: this.projectPath,
    }
  }

  async findProjectRoot(): Promise<string | undefined> {
    return this.projectPath
  }
}
