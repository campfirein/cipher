import {Args, Command, Flags} from '@oclif/core'
import chalk from 'chalk'
import {join} from 'node:path'

import type {IContextTreeService} from '../core/interfaces/i-context-tree-service.js'
import type {IContextTreeSnapshotService} from '../core/interfaces/i-context-tree-snapshot-service.js'
import type {IProjectConfigStore} from '../core/interfaces/i-project-config-store.js'
import type {ITokenStore} from '../core/interfaces/i-token-store.js'

import {BRV_DIR, CONTEXT_TREE_DIR} from '../constants.js'
import {ITrackingService} from '../core/interfaces/i-tracking-service.js'
import {ProjectConfigStore} from '../infra/config/file-config-store.js'
import {FileContextTreeService} from '../infra/context-tree/file-context-tree-service.js'
import {FileContextTreeSnapshotService} from '../infra/context-tree/file-context-tree-snapshot-service.js'
import {KeychainTokenStore} from '../infra/storage/keychain-token-store.js'
import {MixpanelTrackingService} from '../infra/tracking/mixpanel-tracking-service.js'
import {getErrorMessage} from '../utils/error-helpers.js'

export default class Status extends Command {
  public static args = {
    directory: Args.string({description: 'Project directory (defaults to current directory)', required: false}),
  }
  public static description =
    'Show CLI status and project information. Display local context tree managed by ByteRover CLI'
  public static examples = [
    '<%= config.bin %> <%= command.id %>',
    '# Check status after login:\n<%= config.bin %> login\n<%= config.bin %> <%= command.id %>',
    '# Verify project initialization:\n<%= config.bin %> init\n<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> /path/to/project',
    '<%= config.bin %> <%= command.id %> --format json',
  ]
  public static flags = {
    format: Flags.string({
      char: 'f',
      default: 'table',
      description: 'Output format',
      options: ['table', 'json'],
    }),
  }

  // Override catch to prevent oclif from displaying errors again
  async catch(error: Error): Promise<void> {
    // Status command should always succeed and just show status
    // Any errors are already handled and logged in run()
    throw error
  }

  protected createServices(): {
    contextTreeService: IContextTreeService
    contextTreeSnapshotService: IContextTreeSnapshotService
    projectConfigStore: IProjectConfigStore
    tokenStore: ITokenStore
    trackingService: ITrackingService
  } {
    const tokenStore = new KeychainTokenStore()
    const trackingService = new MixpanelTrackingService(tokenStore)

    return {
      contextTreeService: new FileContextTreeService(),
      contextTreeSnapshotService: new FileContextTreeSnapshotService(),
      projectConfigStore: new ProjectConfigStore(),
      tokenStore,
      trackingService,
    }
  }

  public async run(): Promise<void> {
    const {contextTreeService, contextTreeSnapshotService, projectConfigStore, tokenStore, trackingService} =
      this.createServices()

    this.log(`CLI Version: ${this.config.version}`)

    try {
      const token = await tokenStore.load()

      if (token !== undefined && token.isValid()) {
        this.log(`Status: Logged in as ${token.userEmail}`)
      } else if (token === undefined) {
        this.log('Status: Not logged in')
      } else {
        this.log('Status: Session expired (login required)')
      }
    } catch (error) {
      this.log('Status: Unable to check authentication status')
      this.warn(`Warning: ${getErrorMessage(error)}`)
    }

    const cwd = process.cwd()
    this.log(`Current Directory: ${cwd}`)

    try {
      const isInitialized = await projectConfigStore.exists()

      if (isInitialized) {
        const config = await projectConfigStore.read()
        if (config) {
          this.log(`Project Status: Connected to ${config.teamName}/${config.spaceName}`)
        } else {
          this.log('Project Status: Configuration file exists but is invalid')
        }
      } else {
        this.log('Project Status: Not initialized')
      }
    } catch (error) {
      this.log('Project Status: Unable to read project configuration')
      this.warn(`Warning: ${getErrorMessage(error)}`)
    }

    // Context tree status
    try {
      const contextTreeExists = await contextTreeService.exists()

      if (!contextTreeExists) {
        this.log('Context Tree: Not initialized')
        return
      }

      const hasSnapshot = await contextTreeSnapshotService.hasSnapshot()

      // Auto-create empty snapshot if none exists (all files will show as "added")
      if (!hasSnapshot) {
        await contextTreeSnapshotService.initEmptySnapshot()
      }

      const changes = await contextTreeSnapshotService.getChanges()
      const hasChanges = changes.added.length > 0 || changes.modified.length > 0 || changes.deleted.length > 0

      if (!hasChanges) {
        this.log('Context Tree: No changes')
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

      this.log('Context Tree Changes:')
      for (const change of allChanges) {
        this.log(`\t${change.color(`${change.status.padEnd(10)} ${formatPath(change.path)}`)}`)
      }

      // Track status
      await trackingService.track('mem:status')
    } catch (error) {
      this.log('Context Tree: Unable to check status')
      this.warn(`Warning: ${error instanceof Error ? error.message : 'Context Tree unable to check status'}`)
    }
  }
}
