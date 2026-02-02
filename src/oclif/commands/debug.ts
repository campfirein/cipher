import {
  ConnectionError,
  ConnectionFailedError,
  connectToTransport,
  DaemonInstanceDiscovery,
  InstanceCrashedError,
  type ITransportClient,
  NoInstanceRunningError,
} from '@campfirein/brv-transport-client'
import {Command, Flags} from '@oclif/core'
import chalk from 'chalk'

import type {DaemonStatus} from '../../server/infra/daemon/daemon-discovery.js'

import {discoverDaemon} from '../../server/infra/daemon/daemon-discovery.js'

/**
 * Shape of daemon:getState response.
 * Defined locally — this command is the only consumer.
 */
type DaemonState = {
  agentPool: {
    entries: Array<{
      childPid: number | undefined
      createdAt: number
      hasActiveTask: boolean
      isIdle: boolean
      lastUsedAt: number
      projectPath: string
    }>
    maxSize: number
    queue: Array<{projectPath: string; queueLength: number}>
    size: number
  }
  clients: Array<{
    connectedAt: number
    id: string
    projectPath?: string
    type: string
  }>
  daemon: {
    pid: number
    port: number
    startedAt: number
    uptime: number
    version: string
  }
  tasks: {
    activeTasks: Array<{
      clientId: string
      createdAt: number
      projectPath?: string
      taskId: string
      type: string
    }>
    agentClients: Array<{clientId: string; projectPath: string}>
  }
  transport: {
    connectedSockets: number
    port: number
    running: boolean
  }
}

export default class Debug extends Command {
  public static description = 'Show internal daemon state for debugging'
  public static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --format json',
  ]
  public static flags = {
    format: Flags.string({
      char: 'f',
      default: 'tree',
      description: 'Output format',
      options: ['tree', 'json'],
    }),
  }

  protected connect(): Promise<{client: ITransportClient; projectRoot: string}> {
    return connectToTransport(process.cwd(), {discovery: new DaemonInstanceDiscovery()})
  }

  protected discover(): DaemonStatus {
    return discoverDaemon()
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(Debug)
    const format = flags.format === 'json' ? 'json' : 'tree'

    // Quick check: is daemon even running?
    const daemonStatus = this.discover()
    if (!daemonStatus.running) {
      if (format === 'json') {
        this.log(JSON.stringify({reason: daemonStatus.reason, running: false}, null, 2))
      } else {
        this.log(`Daemon is not running (${daemonStatus.reason})`)
        this.log('\nStart with: brv')
      }

      return
    }

    // Connect to daemon via transport
    let client: ITransportClient | undefined
    try {
      const result = await this.connect()
      client = result.client

      // Request state snapshot
      const response = await client.requestWithAck<{data: DaemonState}>('daemon:getState')
      const state = response.data

      // Render
      if (format === 'json') {
        this.log(JSON.stringify(state, null, 2))
      } else {
        this.renderTree(state)
      }
    } catch (error) {
      if (error instanceof NoInstanceRunningError) {
        this.log('No daemon is running. Start one with: brv')
      } else if (error instanceof InstanceCrashedError) {
        this.log('Daemon has crashed. Restart with: brv')
      } else if (error instanceof ConnectionFailedError || error instanceof ConnectionError) {
        this.log(`Failed to connect to daemon: ${error.message}`)
      } else {
        const message = error instanceof Error ? error.message : String(error)
        this.log(`Error: ${message}`)
      }
    } finally {
      if (client) {
        await client.disconnect()
      }
    }
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)

    if (hours > 0) return `${hours}h ${minutes % 60}m`
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`
    return `${seconds}s`
  }

  private formatTimeAgo(timestamp: number): string {
    return this.formatDuration(Date.now() - timestamp) + ' ago'
  }

  private renderTree(state: DaemonState): void {
    const {agentPool, clients, daemon, tasks, transport} = state
    const lines: string[] = []

    // Root + Transport Server + Agent Pool header
    lines.push(
      chalk.bold(
        `Daemon (PID: ${daemon.pid}, port: ${daemon.port}, uptime: ${this.formatDuration(daemon.uptime)}, v${daemon.version})`,
      ),
      '├── Transport Server',
      `│   ├── Status: ${transport.running ? chalk.green('Running') : chalk.red('Stopped')}`,
      `│   ├── Port: ${transport.port}`,
      `│   └── Connected sockets: ${transport.connectedSockets}`,
      `├── Agent Pool (${agentPool.size}/${agentPool.maxSize})`,
    )
    if (agentPool.entries.length === 0) {
      lines.push('│   └── (empty)')
    } else {
      for (const [i, entry] of agentPool.entries.entries()) {
        const isLast = i === agentPool.entries.length - 1
        const prefix = isLast ? '│   └── ' : '│   ├── '
        const childPrefix = isLast ? '│       ' : '│   │   '
        const status = entry.hasActiveTask
          ? chalk.yellow('busy')
          : entry.isIdle
            ? chalk.dim('idle')
            : chalk.green('ready')

        lines.push(
          `${prefix}${entry.projectPath}`,
          `${childPrefix}├── PID: ${entry.childPid ?? 'unknown'}`,
          `${childPrefix}├── Status: ${status}`,
          `${childPrefix}├── Created: ${this.formatTimeAgo(entry.createdAt)}`,
          `${childPrefix}└── Last used: ${this.formatTimeAgo(entry.lastUsedAt)}`,
        )
      }
    }

    // Task Queue
    lines.push('├── Task Queue')
    if (agentPool.queue.length === 0) {
      lines.push('│   └── (empty)')
    } else {
      for (const [i, q] of agentPool.queue.entries()) {
        const isLast = i === agentPool.queue.length - 1
        const prefix = isLast ? '│   └── ' : '│   ├── '
        lines.push(`${prefix}${q.projectPath}: ${q.queueLength} queued`)
      }
    }

    // Active Tasks
    lines.push(`├── Active Tasks (${tasks.activeTasks.length})`)
    if (tasks.activeTasks.length === 0) {
      lines.push('│   └── (none)')
    } else {
      for (const [i, task] of tasks.activeTasks.entries()) {
        const isLast = i === tasks.activeTasks.length - 1
        const prefix = isLast ? '│   └── ' : '│   ├── '
        const childPrefix = isLast ? '│       ' : '│   │   '

        lines.push(
          `${prefix}${task.taskId}`,
          `${childPrefix}├── Type: ${task.type}`,
          `${childPrefix}├── Client: ${task.clientId}`,
          `${childPrefix}└── Project: ${task.projectPath ?? '(none)'}`,
        )
      }
    }

    // Connected Clients
    lines.push(`└── Connected Clients (${clients.length})`)
    if (clients.length === 0) {
      lines.push('    └── (none)')
    } else {
      for (const [i, client] of clients.entries()) {
        const isLast = i === clients.length - 1
        const prefix = isLast ? '    └── ' : '    ├── '
        const childPrefix = isLast ? '        ' : '    │   '
        const typeColor =
          client.type === 'agent' ? chalk.cyan(client.type) : client.type === 'tui' ? chalk.green(client.type) : chalk.blue(client.type)

        lines.push(
          `${prefix}${client.id} (${typeColor})`,
          `${childPrefix}└── Project: ${client.projectPath ?? chalk.dim('(no project)')}`,
        )
      }
    }

    this.log(lines.join('\n'))
  }
}
