import chalk from 'chalk'
import {join} from 'node:path'

import type {IContextTreeService} from '../../core/interfaces/i-context-tree-service.js'
import type {IContextTreeSnapshotService} from '../../core/interfaces/i-context-tree-snapshot-service.js'
import type {IProjectConfigStore} from '../../core/interfaces/i-project-config-store.js'
import type {ITerminal} from '../../core/interfaces/i-terminal.js'
import type {ITokenStore} from '../../core/interfaces/i-token-store.js'
import type {ITrackingService} from '../../core/interfaces/i-tracking-service.js'
import type {IStatusUseCase} from '../../core/interfaces/usecase/i-status-use-case.js'

import {BRV_DIR, CONTEXT_TREE_DIR} from '../../constants.js'
import {getErrorMessage} from '../../utils/error-helpers.js'

export interface StatusUseCaseOptions {
  contextTreeService: IContextTreeService
  contextTreeSnapshotService: IContextTreeSnapshotService
  projectConfigStore: IProjectConfigStore
  terminal: ITerminal
  tokenStore: ITokenStore
  trackingService: ITrackingService
}

export class StatusUseCase implements IStatusUseCase {
  private readonly contextTreeService: IContextTreeService
  private readonly contextTreeSnapshotService: IContextTreeSnapshotService
  private readonly projectConfigStore: IProjectConfigStore
  private readonly terminal: ITerminal
  private readonly tokenStore: ITokenStore
  private readonly trackingService: ITrackingService

  constructor(options: StatusUseCaseOptions) {
    this.contextTreeService = options.contextTreeService
    this.contextTreeSnapshotService = options.contextTreeSnapshotService
    this.projectConfigStore = options.projectConfigStore
    this.terminal = options.terminal
    this.tokenStore = options.tokenStore
    this.trackingService = options.trackingService
  }

  public async run(options: {cliVersion: string}): Promise<void> {
    this.terminal.log(`CLI Version: ${options.cliVersion}`)

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
        if (config) {
          this.terminal.log(`Project Status: Connected to ${config.teamName}/${config.spaceName}`)
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

      // Track status
      await this.trackingService.track('mem:status')
    } catch (error) {
      this.terminal.log('Context Tree: Unable to check status')
      this.terminal.warn(`Warning: ${error instanceof Error ? error.message : 'Context Tree unable to check status'}`)
    }
  }
}
