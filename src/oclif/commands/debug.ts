import {
  ConnectionError,
  ConnectionFailedError,
  connectToTransport,
  DAEMON_STOP_BUDGET_MS,
  DAEMON_STOP_POLL_INTERVAL_MS,
  DaemonInstanceDiscovery,
  discoverDaemon,
  type EnsureDaemonResult,
  ensureDaemonRunning,
  InstanceCrashedError,
  isProcessAlive,
  type ITransportClient,
  NoInstanceRunningError,
} from '@campfirein/brv-transport-client'
import {Command, Flags} from '@oclif/core'
import chalk from 'chalk'

/**
 * Refresh interval for monitor mode (ms).
 */
const MONITOR_REFRESH_MS = 2000

/**
 * Shape of daemon:getState response.
 * Defined locally — this command is the only consumer.
 */
type DaemonState = {
  agentIdleStatus: Array<{
    idleMs: number
    projectPath: string
    remainingMs: number
  }>
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
    agentName?: string
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
  daemonIdleStatus?:
    | undefined
    | {
        clientCount: number
        idleMs: number
        remainingMs: number
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
    completedTasks: Array<{
      completedAt: number
      projectPath?: string
      taskId: string
      type: string
    }>
  }
  transport: {
    connectedSockets: number
    port: number
    running: boolean
  }
}

export default class Debug extends Command {
  public static description = 'Live monitor for daemon internal state'
  public static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --format json',
    '<%= config.bin %> <%= command.id %> --once',
  ]
  public static flags = {
    force: Flags.boolean({
      default: false,
      description: 'Kill existing daemon and start fresh',
    }),
    format: Flags.string({
      char: 'f',
      default: 'tree',
      description: 'Output format',
      options: ['tree', 'json'],
    }),
    once: Flags.boolean({
      default: false,
      description: 'Print once and exit (no live monitoring)',
    }),
  }

  protected clearScreen(): void {
    if (process.stdout.isTTY) {
      process.stdout.write('\u001B[2J\u001B[H')
    }
  }

  protected connect(): Promise<{client: ITransportClient; projectRoot?: string}> {
    // Debug commands should not register to avoid blocking daemon idle timeout
    return connectToTransport(process.cwd(), {autoRegister: false, discovery: new DaemonInstanceDiscovery()})
  }

  protected ensureDaemon(): Promise<EnsureDaemonResult> {
    return ensureDaemonRunning()
  }

  /**
   * Kill the running daemon and wait for it to die.
   * Internal to debug --force. Returns the PID that was killed, or undefined if none found.
   */
  protected async killExistingDaemon(): Promise<number | undefined> {
    const status = discoverDaemon()
    // Collect PID from any variant that has one
    const pid = status.running ? status.pid : status.reason === 'no_instance' ? undefined : status.pid
    if (pid === undefined || !isProcessAlive(pid)) return undefined

    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      return pid
    }

    const deadline = Date.now() + DAEMON_STOP_BUDGET_MS
    while (Date.now() < deadline) {
      if (!isProcessAlive(pid)) return pid
      // eslint-disable-next-line no-await-in-loop
      await new Promise<void>((resolve) => {
        setTimeout(resolve, DAEMON_STOP_POLL_INTERVAL_MS)
      })
    }

    // SIGTERM didn't work — force kill
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // already dead
    }

    return pid
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(Debug)
    const format = flags.format === 'json' ? 'json' : 'tree'
    // JSON format always implies one-shot (useful for scripting / piping)
    const oneShot = flags.once || format === 'json'

    // --force: kill existing daemon, then start a fresh one
    if (flags.force) {
      await this.killExistingDaemon()

      const ensureResult = await this.ensureDaemon()
      if (!ensureResult.success) {
        if (format === 'json') {
          this.log(JSON.stringify({reason: ensureResult.reason, running: false}, null, 2))
        } else {
          this.log(`Daemon failed to start: ${chalk.red(ensureResult.reason)}`)
        }

        return
      }
    }

    // Connect to existing daemon (no auto-start)
    let client: ITransportClient | undefined
    try {
      const result = await this.connect()
      client = result.client

      await (oneShot ? this.renderOnce(client, format) : this.runMonitor(client))
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

  private delay(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve) => {
      if (signal.aborted) {
        resolve()
        return
      }

      const timer = setTimeout(resolve, ms)
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer)
          resolve()
        },
        {once: true},
      )
    })
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

  private renderAgentPool(
    lines: string[],
    agentPool: DaemonState['agentPool'],
    agentIdleStatus: DaemonState['agentIdleStatus'],
  ): void {
    lines.push(`├── Agent Pool (${agentPool.size}/${agentPool.maxSize})`)
    if (agentPool.entries.length === 0) {
      lines.push('│   └── (empty)')
      return
    }

    for (const [i, entry] of agentPool.entries.entries()) {
      const isLast = i === agentPool.entries.length - 1
      const prefix = isLast ? '│   └── ' : '│   ├── '
      const childPrefix = isLast ? '│       ' : '│   │   '
      const status = entry.hasActiveTask
        ? chalk.yellow('busy')
        : entry.isIdle
          ? chalk.dim('idle')
          : chalk.green('ready')

      const idleInfo = agentIdleStatus.find((s) => s.projectPath === entry.projectPath)
      const idleCountdown =
        idleInfo && idleInfo.remainingMs < 60_000
          ? chalk.yellow(` (will be killed in ${this.formatDuration(idleInfo.remainingMs)})`)
          : ''

      lines.push(
        `${prefix}${entry.projectPath}`,
        `${childPrefix}├── PID: ${entry.childPid ?? 'unknown'}`,
        `${childPrefix}├── Status: ${status}${idleCountdown}`,
        `${childPrefix}├── Created: ${this.formatTimeAgo(entry.createdAt)}`,
        `${childPrefix}└── Last used: ${this.formatTimeAgo(entry.lastUsedAt)}`,
      )
    }
  }

  private renderClients(lines: string[], clients: DaemonState['clients']): void {
    lines.push(`└── Connected Clients (${clients.length})`)
    if (clients.length === 0) {
      lines.push('    └── (none)')
      return
    }

    for (const [i, client] of clients.entries()) {
      const isLast = i === clients.length - 1
      const prefix = isLast ? '    └── ' : '    ├── '
      const childPrefix = isLast ? '        ' : '    │   '
      const typeLabel = client.agentName ? `${client.type} · ${client.agentName}` : client.type
      const typeColor =
        client.type === 'agent'
          ? chalk.cyan(typeLabel)
          : client.type === 'tui'
            ? chalk.green(typeLabel)
            : chalk.blue(typeLabel)

      lines.push(
        `${prefix}${client.id} (${typeColor})`,
        `${childPrefix}└── Project: ${client.projectPath ?? chalk.dim('(no project)')}`,
      )
    }
  }

  private async renderOnce(client: ITransportClient, format: string): Promise<void> {
    const state = await client.requestWithAck<DaemonState>('daemon:getState')

    if (format === 'json') {
      this.log(JSON.stringify(state, null, 2))
    } else {
      this.renderTree(state)
    }
  }

  private renderTasks(lines: string[], tasks: DaemonState['tasks']): void {
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

    const completedTasks = tasks.completedTasks ?? []
    if (completedTasks.length > 0) {
      lines.push(`├── Recently Completed (${completedTasks.length})`)
      for (const [i, task] of completedTasks.entries()) {
        const isLast = i === completedTasks.length - 1
        const prefix = isLast ? '│   └── ' : '│   ├── '
        const childPrefix = isLast ? '│       ' : '│   │   '

        lines.push(
          `${prefix}${chalk.dim(task.taskId)}`,
          `${childPrefix}├── Type: ${task.type}`,
          `${childPrefix}├── Completed: ${this.formatTimeAgo(task.completedAt)}`,
          `${childPrefix}└── Project: ${task.projectPath ?? '(none)'}`,
        )
      }
    }
  }

  private renderTree(state: DaemonState): void {
    const {agentIdleStatus, agentPool, clients, daemon, daemonIdleStatus, tasks, transport} = state
    const lines: string[] = []

    // Root
    lines.push(
      chalk.bold(
        `Daemon (PID: ${daemon.pid}, port: ${daemon.port}, uptime: ${this.formatDuration(daemon.uptime)}, v${daemon.version})`,
      ),
    )

    // Daemon idle status
    if (daemonIdleStatus) {
      const idleDuration = this.formatDuration(daemonIdleStatus.idleMs)
      const remainingDuration = this.formatDuration(daemonIdleStatus.remainingMs)
      const statusText =
        daemonIdleStatus.remainingMs > 0
          ? chalk.yellow(`Idle for ${idleDuration} (will shutdown in ${remainingDuration})`)
          : chalk.red('Shutting down...')
      lines.push(`├── Status: ${statusText}`)
    } else {
      lines.push(`├── Status: ${chalk.green('Active')} (${clients.length} clients connected)`)
    }

    // Transport Server
    lines.push(
      '├── Transport Server',
      `│   ├── Status: ${transport.running ? chalk.green('Running') : chalk.red('Stopped')}`,
      `│   ├── Port: ${transport.port}`,
      `│   └── Connected sockets: ${transport.connectedSockets}`,
    )

    this.renderAgentPool(lines, agentPool, agentIdleStatus)

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

    this.renderTasks(lines, tasks)
    this.renderClients(lines, clients)

    this.log(lines.join('\n'))
  }

  private async runMonitor(client: ITransportClient): Promise<void> {
    const abortController = new AbortController()

    const stop = (): void => {
      abortController.abort()
    }

    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)

    const poll = async (): Promise<boolean> => {
      const state = await client.requestWithAck<DaemonState>('daemon:getState')
      this.clearScreen()
      this.renderTree(state)
      this.log(chalk.dim(`\nRefreshing every ${MONITOR_REFRESH_MS / 1000}s — press Ctrl+C to exit`))
      await this.delay(MONITOR_REFRESH_MS, abortController.signal)
      return !abortController.signal.aborted
    }

    try {
      // eslint-disable-next-line no-await-in-loop
      while (!abortController.signal.aborted && (await poll())) {
        // poll() handles fetch + render + delay
      }
    } catch (error) {
      if (!abortController.signal.aborted) {
        const detail = error instanceof Error ? error.message : String(error)
        this.log(chalk.red(`\nConnection to daemon lost: ${detail}`))
      }
    } finally {
      process.removeListener('SIGINT', stop)
      process.removeListener('SIGTERM', stop)
    }
  }
}
