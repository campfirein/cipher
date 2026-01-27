import {getCurrentConfig} from '../../config/environment.js'
import {DEFAULT_BRANCH} from '../../constants.js'
import {HttpCogitPushService} from '../../infra/cogit/http-cogit-push-service.js'
import {ProjectConfigStore} from '../../infra/config/file-config-store.js'
import {FileContextFileReader} from '../../infra/context-tree/file-context-file-reader.js'
import {FileContextTreeSnapshotService} from '../../infra/context-tree/file-context-tree-snapshot-service.js'
import {FileGlobalConfigStore} from '../../infra/storage/file-global-config-store.js'
import {createTokenStore} from '../../infra/storage/token-store.js'
import {ReplTerminal} from '../../infra/terminal/repl-terminal.js'
import {MixpanelTrackingService} from '../../infra/tracking/mixpanel-tracking-service.js'
import {PushUseCase} from '../../infra/usecase/push-use-case.js'
import {CommandContext, CommandKind, SlashCommand} from '../types.js'
import {Flags, parseReplArgs, toCommandFlags} from './arg-parser.js'

// Flags - defined once, used for both parsing and help display
const pushFlags = {
  branch: Flags.string({
    char: 'b',
    default: DEFAULT_BRANCH,
    description: 'ByteRover branch name (not Git branch)',
  }),
  yes: Flags.boolean({
    char: 'y',
    default: false,
    description: 'Skip confirmation prompt',
  }),
}

/**
 * Push command
 */
export const pushCommand: SlashCommand = {
  action(_context: CommandContext, args: string) {
    return {
      async execute(onMessage, onPrompt) {
        const terminal = new ReplTerminal({onMessage, onPrompt})

        const parsed = await parseReplArgs(args, {flags: pushFlags, strict: false})

        const envConfig = getCurrentConfig()
        const tokenStore = createTokenStore()
        const globalConfigStore = new FileGlobalConfigStore()
        const trackingService = new MixpanelTrackingService({globalConfigStore, tokenStore})

        const useCase = new PushUseCase({
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

        await useCase.run({
          branch: parsed.flags.branch ?? DEFAULT_BRANCH,
          skipConfirmation: parsed.flags.yes ?? false,
        })
      },
      type: 'streaming',
    }
  },
  aliases: [],
  autoExecute: true,
  description: 'Push context tree to ByteRover memory storage',
  flags: toCommandFlags(pushFlags),
  kind: CommandKind.BUILT_IN,
  name: 'push',
}
