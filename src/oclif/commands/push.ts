import {Command, Flags} from '@oclif/core'

import {getCurrentConfig} from '../../server/config/environment.js'
import {DEFAULT_BRANCH} from '../../server/constants.js'
import {IPushUseCase} from '../../server/core/interfaces/usecase/i-push-use-case.js'
import {HttpCogitPushService} from '../../server/infra/cogit/http-cogit-push-service.js'
import {ProjectConfigStore} from '../../server/infra/config/file-config-store.js'
import {FileContextFileReader} from '../../server/infra/context-tree/file-context-file-reader.js'
import {FileContextTreeSnapshotService} from '../../server/infra/context-tree/file-context-tree-snapshot-service.js'
import {FileGlobalConfigStore} from '../../server/infra/storage/file-global-config-store.js'
import {createTokenStore} from '../../server/infra/storage/token-store.js'
import {HeadlessTerminal} from '../../server/infra/terminal/headless-terminal.js'
import {OclifTerminal} from '../../server/infra/terminal/oclif-terminal.js'
import {MixpanelTrackingService} from '../../server/infra/tracking/mixpanel-tracking-service.js'
import {PushUseCase} from '../../server/infra/usecase/push-use-case.js'

/** Parsed flags type */
type PushFlags = {
  branch?: string
  format?: 'json' | 'text'
  headless?: boolean
  yes?: boolean
}

export default class Push extends Command {
  public static description = `Push context tree to ByteRover memory storage

Uploads your local context tree changes to the ByteRover cloud.`
  public static examples = [
    '# Push to default branch (main)',
    '<%= config.bin %> <%= command.id %>',
    '',
    '# Push to specific branch',
    '<%= config.bin %> <%= command.id %> --branch feature-branch',
    '',
    '# Skip confirmation prompt',
    '<%= config.bin %> <%= command.id %> -y',
    '',
    '# Headless mode with JSON output',
    '<%= config.bin %> <%= command.id %> --headless --format json -y',
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
    yes: Flags.boolean({
      char: 'y',
      default: false,
      description: 'Skip confirmation prompt',
    }),
  }

  protected createUseCase(options: {format: 'json' | 'text'; headless: boolean}): IPushUseCase {
    const envConfig = getCurrentConfig()
    const tokenStore = createTokenStore()
    const globalConfigStore = new FileGlobalConfigStore()
    const trackingService = new MixpanelTrackingService({globalConfigStore, tokenStore})

    // Use HeadlessTerminal for headless mode or JSON format
    const terminal =
      options.headless || options.format === 'json'
        ? new HeadlessTerminal({failOnPrompt: true, outputFormat: options.format})
        : new OclifTerminal(this)

    return new PushUseCase({
      cogitPushService: new HttpCogitPushService({
        apiBaseUrl: envConfig.cogitApiBaseUrl,
      }),
      contextFileReader: new FileContextFileReader(),
      contextTreeSnapshotService: new FileContextTreeSnapshotService(),
      projectConfigStore: new ProjectConfigStore(),
      terminal,
      tokenStore,
      trackingService,
      webAppUrl: envConfig.webAppUrl,
    })
  }

  public async run(): Promise<void> {
    const {flags: rawFlags} = await this.parse(Push)
    const flags = rawFlags as PushFlags
    const format = (flags.format ?? 'text') as 'json' | 'text'
    const headless = flags.headless ?? false

    // In headless mode, always skip confirmation
    const skipConfirmation = headless || flags.yes || false

    await this.createUseCase({format, headless}).run({
      branch: flags.branch ?? DEFAULT_BRANCH,
      format,
      skipConfirmation,
    })
  }
}
