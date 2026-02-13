import {InstanceCrashedError, NoInstanceRunningError} from '@campfirein/brv-transport-client'
import chalk from 'chalk'
import {join} from 'node:path'

import type {ITokenStore} from '../../core/interfaces/auth/i-token-store.js'
import type {IContextTreeService} from '../../core/interfaces/context-tree/i-context-tree-service.js'
import type {IContextTreeSnapshotService} from '../../core/interfaces/context-tree/i-context-tree-snapshot-service.js'
import type {ITerminal} from '../../core/interfaces/services/i-terminal.js'
import type {IProjectConfigStore} from '../../core/interfaces/storage/i-project-config-store.js'
import type {IStatusUseCase} from '../../core/interfaces/usecase/i-status-use-case.js'

import {BRV_DIR, CONTEXT_TREE_DIR} from '../../constants.js'
import {getErrorMessage} from '../../utils/error-helpers.js'
import {HeadlessTerminal} from '../terminal/headless-terminal.js'
import {createDaemonAwareConnector, type TransportConnector} from '../transport/transport-connector.js'

export type {TransportConnector} from '../transport/transport-connector.js'

/**
 * Structured status data for JSON output.
 */
export interface StatusData {
  authStatus: 'expired' | 'logged_in' | 'not_logged_in' | 'unknown'
  cliVersion: string
  contextTreeChanges?: {
    added: string[]
    deleted: string[]
    modified: string[]
  }
  contextTreeStatus: 'has_changes' | 'no_changes' | 'not_initialized' | 'unknown'
  currentDirectory: string
  mcpStatus: 'connected' | 'crashed' | 'error' | 'no_instance' | 'not_responsive'
  projectInitialized: boolean
  spaceName?: string
  teamName?: string
  userEmail?: string
}

export interface StatusUseCaseOptions {
  contextTreeService: IContextTreeService
  contextTreeSnapshotService: IContextTreeSnapshotService
  projectConfigStore: IProjectConfigStore
  terminal: ITerminal
  tokenStore: ITokenStore
  /** Optional transport connector for dependency injection (defaults to connectToTransport) */
  transportConnector?: TransportConnector
}

export class StatusUseCase implements IStatusUseCase {
  private readonly contextTreeService: IContextTreeService
  private readonly contextTreeSnapshotService: IContextTreeSnapshotService
  private readonly projectConfigStore: IProjectConfigStore
  private readonly terminal: ITerminal
  private readonly tokenStore: ITokenStore
  private readonly transportConnector: TransportConnector

  constructor(options: StatusUseCaseOptions) {
    this.contextTreeService = options.contextTreeService
    this.contextTreeSnapshotService = options.contextTreeSnapshotService
    this.projectConfigStore = options.projectConfigStore
    this.terminal = options.terminal
    this.tokenStore = options.tokenStore
    this.transportConnector = options.transportConnector ?? createDaemonAwareConnector()
  }

  public async run(options: {cliVersion: string; format?: 'json' | 'text'}): Promise<void> {
    const format = options.format ?? 'text'

    if (format === 'json') {
      const statusData = await this.collectStatusData(options.cliVersion)
      this.outputJsonStatus(statusData)
      return
    }

    // Text format output (original behavior)
    await this.runTextFormat(options.cliVersion)
  }

  /**
   * Checks the MCP connection status by:
   * 1. Discovering running brv instance and connecting via transport
   * 2. Verifying bidirectional communication with ping
   */
  private async checkMcpStatus(): Promise<void> {
    try {
      const {client, projectRoot} = await this.transportConnector(process.cwd())

      try {
        const isResponsive = await client.isConnected(2000)

        if (isResponsive) {
          this.terminal.log(`MCP Status: ${chalk.green('Connected and responsive')} (${projectRoot})`)
        } else {
          this.terminal.log(`MCP Status: ${chalk.yellow('Connected but not responsive')} (ping timeout)`)
        }
      } finally {
        await client.disconnect()
      }
    } catch (error) {
      if (error instanceof InstanceCrashedError) {
        this.terminal.log(`MCP Status: ${chalk.red('Instance crashed')} (stale instance file found)`)
      } else if (error instanceof NoInstanceRunningError) {
        this.terminal.log(`MCP Status: ${chalk.yellow('No instance running')}`)
      } else {
        this.terminal.log(`MCP Status: ${chalk.red('Connection failed')} - ${getErrorMessage(error)}`)
      }
    }
  }

  /**
   * Check MCP status and return structured data.
   */
  private async checkMcpStatusData(): Promise<StatusData['mcpStatus']> {
    try {
      const {client} = await this.transportConnector(process.cwd())

      try {
        const isResponsive = await client.isConnected(2000)
        return isResponsive ? 'connected' : 'not_responsive'
      } finally {
        await client.disconnect()
      }
    } catch (error) {
      if (error instanceof InstanceCrashedError) return 'crashed'
      if (error instanceof NoInstanceRunningError) return 'no_instance'
      return 'error'
    }
  }

  /**
   * Collect all status data into a structured object for JSON output.
   */
  private async collectStatusData(cliVersion: string): Promise<StatusData> {
    const statusData: StatusData = {
      authStatus: 'unknown',
      cliVersion,
      contextTreeStatus: 'unknown',
      currentDirectory: process.cwd(),
      mcpStatus: 'no_instance',
      projectInitialized: false,
    }

    // Auth status
    try {
      const token = await this.tokenStore.load()
      if (token !== undefined && token.isValid()) {
        statusData.authStatus = 'logged_in'
        statusData.userEmail = token.userEmail
      } else if (token === undefined) {
        statusData.authStatus = 'not_logged_in'
      } else {
        statusData.authStatus = 'expired'
      }
    } catch {
      statusData.authStatus = 'unknown'
    }

    // Project status
    try {
      const isInitialized = await this.projectConfigStore.exists()
      statusData.projectInitialized = isInitialized
      if (isInitialized) {
        const config = await this.projectConfigStore.read()
        if (config?.isCloudConnected()) {
          statusData.teamName = config.teamName
          statusData.spaceName = config.spaceName
        }
      }
    } catch {
      statusData.projectInitialized = false
    }

    // MCP status
    statusData.mcpStatus = await this.checkMcpStatusData()

    // Context tree status
    try {
      const contextTreeExists = await this.contextTreeService.exists()
      if (contextTreeExists) {
        const hasSnapshot = await this.contextTreeSnapshotService.hasSnapshot()
        if (!hasSnapshot) {
          await this.contextTreeSnapshotService.initEmptySnapshot()
        }

        const changes = await this.contextTreeSnapshotService.getChanges()
        const hasChanges = changes.added.length > 0 || changes.modified.length > 0 || changes.deleted.length > 0

        if (hasChanges) {
          statusData.contextTreeStatus = 'has_changes'
          statusData.contextTreeChanges = {
            added: changes.added,
            deleted: changes.deleted,
            modified: changes.modified,
          }
        } else {
          statusData.contextTreeStatus = 'no_changes'
        }
      } else {
        statusData.contextTreeStatus = 'not_initialized'
      }
    } catch {
      statusData.contextTreeStatus = 'unknown'
    }

    return statusData
  }

  /**
   * Output status data as JSON.
   */
  private outputJsonStatus(statusData: StatusData): void {
    const response = {
      command: 'status',
      data: statusData,
      success: true,
      timestamp: new Date().toISOString(),
    }

    // Write directly to stdout for clean JSON output
    if (this.terminal instanceof HeadlessTerminal) {
      this.terminal.writeFinalResponse(response)
    } else {
      // Fallback for non-headless terminal
      this.terminal.log(JSON.stringify(response))
    }
  }

  /**
   * Original text format output.
   */
  private async runTextFormat(cliVersion: string): Promise<void> {
    this.terminal.log(`CLI Version: ${cliVersion}`)

    try {
      const token = await this.tokenStore.load()

      if (token !== undefined && token.isValid()) {
        this.terminal.log(`Status: Logged in as ${token.userEmail}`)
      } else if (token === undefined) {
        this.terminal.log('Status: Not logged in')
      } else {
        this.terminal.log('Status: Session expired (login required)')
      }
    } catch (error) {
      this.terminal.log('Status: Unable to check authentication status')
      this.terminal.warn(`Warning: ${getErrorMessage(error)}`)
    }

    const cwd = process.cwd()
    this.terminal.log(`Current Directory: ${cwd}`)

    try {
      const isInitialized = await this.projectConfigStore.exists()

      if (isInitialized) {
        const config = await this.projectConfigStore.read()
        if (config?.isCloudConnected()) {
          this.terminal.log(`Project Status: Connected to ${config.teamName}/${config.spaceName}`)
        } else if (config) {
          this.terminal.log('Project Status: Initialized (local)')
        } else {
          this.terminal.log('Project Status: Configuration file exists but is invalid')
        }
      } else {
        this.terminal.log('Project Status: Not initialized')
      }
    } catch (error) {
      this.terminal.log('Project Status: Unable to read project configuration')
      this.terminal.warn(`Warning: ${getErrorMessage(error)}`)
    }

    // MCP connection status
    await this.checkMcpStatus()

    // Context tree status
    try {
      const contextTreeExists = await this.contextTreeService.exists()

      if (!contextTreeExists) {
        this.terminal.log('Context Tree: Not initialized')
        return
      }

      const hasSnapshot = await this.contextTreeSnapshotService.hasSnapshot()

      // Auto-create empty snapshot if none exists (all files will show as "added")
      if (!hasSnapshot) {
        await this.contextTreeSnapshotService.initEmptySnapshot()
      }

      const changes = await this.contextTreeSnapshotService.getChanges()
      const hasChanges = changes.added.length > 0 || changes.modified.length > 0 || changes.deleted.length > 0

      if (!hasChanges) {
        this.terminal.log('Context Tree: No changes')
        return
      }

      const contextTreeRelPath = join(BRV_DIR, CONTEXT_TREE_DIR)
      const formatPath = (file: string) => join(contextTreeRelPath, file)

      // Build unified list with status, sort by path ascending
      const allChanges: {color: (s: string) => string; path: string; status: string}[] = [
        ...changes.modified.map((f) => ({color: chalk.red, path: f, status: 'modified:'})),
        ...changes.added.map((f) => ({color: chalk.red, path: f, status: 'new file:'})),
        ...changes.deleted.map((f) => ({color: chalk.red, path: f, status: 'deleted:'})),
      ].sort((a, b) => a.path.localeCompare(b.path))

      this.terminal.log('Context Tree Changes:')
      for (const change of allChanges) {
        this.terminal.log(`   ${change.color(`${change.status.padEnd(10)} ${formatPath(change.path)}`)}`)
      }
    } catch (error) {
      this.terminal.log('Context Tree: Unable to check status')
      this.terminal.warn(`Warning: ${error instanceof Error ? error.message : 'Context Tree unable to check status'}`)
    }
  }
}
