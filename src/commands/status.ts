import {Args, Command, Flags} from '@oclif/core'

import type {IPlaybookStore} from '../core/interfaces/i-playbook-store.js'
import type {IProjectConfigStore} from '../core/interfaces/i-project-config-store.js'
import type {ITokenStore} from '../core/interfaces/i-token-store.js'

import {FilePlaybookStore} from '../infra/ace/file-playbook-store.js'
import {ProjectConfigStore} from '../infra/config/file-config-store.js'
import {KeychainTokenStore} from '../infra/storage/keychain-token-store.js'

export default class Status extends Command {
  public static args = {
    directory: Args.string({description: 'Project directory (defaults to current directory)', required: false}),
  }
  public static description =
    'Show CLI status and project information (displays authentication status, current user, project configuration). Display ACE playbook statistics (shows sections, bullets, and tags for local context managed by ByteRover CLI)'
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

  protected createServices(): {
    playbookStore: IPlaybookStore
    projectConfigStore: IProjectConfigStore
    tokenStore: ITokenStore
  } {
    return {
      playbookStore: new FilePlaybookStore(),
      projectConfigStore: new ProjectConfigStore(),
      tokenStore: new KeychainTokenStore(),
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
        this.error('Playbook not found. Run `br init` to initialize.')
      }

      const stats = playbook.stats()

      if (flags.format === 'json') {
        this.log(JSON.stringify(stats, null, 2))
      } else {
        // Table format
        this.log('# ACE Playbook Statistics\n')
        this.log(`Sections:  ${stats.sections}`)
        this.log(`Bullets:   ${stats.bullets}`)
        this.log(`Tags:      ${stats.tags.length}`)

        if (stats.tags.length > 0) {
          this.log('\n## Tags')
          for (const tag of stats.tags) {
            this.log(`  - ${tag}`)
          }
        }
      }
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Failed to load playbook statistics')
    }
  }
}
