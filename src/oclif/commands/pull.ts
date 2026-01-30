import {Command, Flags} from '@oclif/core'

import type {IPullUseCase} from '../../core/interfaces/usecase/i-pull-use-case.js'

import {getCurrentConfig} from '../../config/environment.js'
import {DEFAULT_BRANCH} from '../../constants.js'
import {HttpCogitPullService} from '../../infra/cogit/http-cogit-pull-service.js'
import {ProjectConfigStore} from '../../infra/config/file-config-store.js'
import {FileContextTreeSnapshotService} from '../../infra/context-tree/file-context-tree-snapshot-service.js'
import {FileContextTreeWriterService} from '../../infra/context-tree/file-context-tree-writer-service.js'
import {FileGlobalConfigStore} from '../../infra/storage/file-global-config-store.js'
import {createTokenStore} from '../../infra/storage/token-store.js'
import {HeadlessTerminal} from '../../infra/terminal/headless-terminal.js'
import {OclifTerminal} from '../../infra/terminal/oclif-terminal.js'
import {MixpanelTrackingService} from '../../infra/tracking/mixpanel-tracking-service.js'
import {PullUseCase} from '../../infra/usecase/pull-use-case.js'

/** Parsed flags type */
type PullFlags = {
  branch?: string
  format?: 'json' | 'text'
  headless?: boolean
}

export default class Pull extends Command {
  public static description = `Pull context tree from ByteRover memory storage

Downloads the context tree from the ByteRover cloud to your local project.`
  public static examples = [
    '# Pull from default branch (main)',
    '<%= config.bin %> <%= command.id %>',
    '',
    '# Pull from specific branch',
    '<%= config.bin %> <%= command.id %> --branch feature-branch',
    '',
    '# Headless mode with JSON output',
    '<%= config.bin %> <%= command.id %> --headless --format json',
  ]
  public static flags = {
    branch: Flags.string({
      char: 'b',
      default: DEFAULT_BRANCH,
      description: 'ByteRover branch name (not Git branch)',
    }),
    format: Flags.string({
      default: 'text',
      description: 'Output format (text or json)',
      options: ['text', 'json'],
    }),
    headless: Flags.boolean({
      default: false,
      description: 'Run in headless mode (no TTY required, suitable for automation)',
    }),
  }

  protected createUseCase(options: {format: 'json' | 'text'; headless: boolean}): IPullUseCase {
    const envConfig = getCurrentConfig()
    const tokenStore = createTokenStore()
    const globalConfigStore = new FileGlobalConfigStore()
    const trackingService = new MixpanelTrackingService({globalConfigStore, tokenStore})
    const contextTreeSnapshotService = new FileContextTreeSnapshotService()

    // Use HeadlessTerminal for headless mode or JSON format
    const terminal =
      options.headless || options.format === 'json'
        ? new HeadlessTerminal({failOnPrompt: true, outputFormat: options.format})
        : new OclifTerminal(this)

    return new PullUseCase({
      cogitPullService: new HttpCogitPullService({
        apiBaseUrl: envConfig.cogitApiBaseUrl,
      }),
      contextTreeSnapshotService,
      contextTreeWriterService: new FileContextTreeWriterService({
        snapshotService: contextTreeSnapshotService,
      }),
      projectConfigStore: new ProjectConfigStore(),
      terminal,
      tokenStore,
      trackingService,
    })
  }

  public async run(): Promise<void> {
    const {flags: rawFlags} = await this.parse(Pull)
    const flags = rawFlags as PullFlags
    const format = (flags.format ?? 'text') as 'json' | 'text'
    const headless = flags.headless ?? false

    await this.createUseCase({format, headless}).run({
      branch: flags.branch ?? DEFAULT_BRANCH,
      format,
    })
  }
}
