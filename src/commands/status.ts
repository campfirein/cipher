import {Args, Command, Flags} from '@oclif/core'
import chalk from 'chalk'

import type {IPlaybookStore} from '../core/interfaces/i-playbook-store.js'
import type {IProjectConfigStore} from '../core/interfaces/i-project-config-store.js'
import type {ITokenStore} from '../core/interfaces/i-token-store.js'

import {ACE_DIR, BRV_DIR, BULLETS_DIR} from '../constants.js'
import {ITrackingService} from '../core/interfaces/i-tracking-service.js'
import {FilePlaybookStore} from '../infra/ace/file-playbook-store.js'
import {ProjectConfigStore} from '../infra/config/file-config-store.js'
import {KeychainTokenStore} from '../infra/storage/keychain-token-store.js'
import {MixpanelTrackingService} from '../infra/tracking/mixpanel-tracking-service.js'

export default class Status extends Command {
  public static args = {
    directory: Args.string({description: 'Project directory (defaults to current directory)', required: false}),
  }
  public static description =
    'Show CLI status and project information. Display local ACE context (ACE playbook) managed by ByteRover CLI'
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
    playbookStore: IPlaybookStore
    projectConfigStore: IProjectConfigStore
    tokenStore: ITokenStore
    trackingService: ITrackingService
  } {
    const tokenStore = new KeychainTokenStore()
    const trackingService = new MixpanelTrackingService(tokenStore)

    return {
      playbookStore: new FilePlaybookStore(),
      projectConfigStore: new ProjectConfigStore(),
      tokenStore,
      trackingService,
    }
  }

  public async run(): Promise<void> {
    const {playbookStore, projectConfigStore, tokenStore} = this.createServices()
    const {args, flags} = await this.parse(Status)

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
      this.warn(`Warning: ${(error as Error).message}`)
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
      this.warn(`Warning: ${(error as Error).message}`)
    }

    try {
      const playbook = await playbookStore.load(args.directory)

      if (!playbook) {
        this.log('Playbook Status: Not initialized (run `brv init` to initialize)')
        return
      }

      // Display based on format
      if (flags.format === 'json') {
        return this.log(JSON.stringify(playbook.toJson(), null, 2))
      }

      // Display file URLs like git status
      const bullets = playbook.getBullets()
      const sections = playbook.getSections()

      if (bullets.length === 0) {
        this.log('Playbook is empty. Use "brv add" commands to add knowledge.')
        return
      }

      this.log(`\nMemory not pushed to cloud:`)

      for (const section of sections) {
        // Space between sections
        this.log(' ')
        // Section title
        this.log(`# ${section}`)
        const sectionBullets = playbook.getBulletsInSection(section)

        for (const bullet of sectionBullets) {
          const relativePath = `${BRV_DIR}/${ACE_DIR}/${BULLETS_DIR}/${bullet.id}.md`

          // Display like git status: red path
          this.log(`  ${chalk.red(relativePath)}`)
        }
      }

      this.log(`\nUse "brv push" to push playbook to ByteRover memory storage.`)
    } catch (error) {
      this.log('Playbook Status: Unable to read playbook')
      this.warn(`Warning: ${error instanceof Error ? error.message : 'Failed to load playbook statistics'}`)
    }
  }
}
