import {getCurrentConfig} from '../../config/environment.js'
import {DEFAULT_BRANCH} from '../../constants.js'
import {HttpCogitPullService} from '../../infra/cogit/http-cogit-pull-service.js'
import {ProjectConfigStore} from '../../infra/config/file-config-store.js'
import {FileContextTreeSnapshotService} from '../../infra/context-tree/file-context-tree-snapshot-service.js'
import {FileContextTreeWriterService} from '../../infra/context-tree/file-context-tree-writer-service.js'
import {FileGlobalConfigStore} from '../../infra/storage/file-global-config-store.js'
import {createTokenStore} from '../../infra/storage/token-store.js'
import {ReplTerminal} from '../../infra/terminal/repl-terminal.js'
import {MixpanelTrackingService} from '../../infra/tracking/mixpanel-tracking-service.js'
import {PullUseCase} from '../../infra/usecase/pull-use-case.js'
import {CommandContext, CommandKind, SlashCommand} from '../types.js'
import {Flags, parseReplArgs, toCommandFlags} from './arg-parser.js'

const pullFlags = {
  branch: Flags.string({
    char: 'b',
    default: DEFAULT_BRANCH,
    description: 'ByteRover branch name (not Git branch)',
  }),
}

/**
 * Pull command
 */
export const pullCommand: SlashCommand = {
  action(_context: CommandContext, args: string) {
    return {
      async execute(onMessage, onPrompt) {
        const terminal = new ReplTerminal({onMessage, onPrompt})

        const parsed = await parseReplArgs(args, {flags: pullFlags, strict: false})

        const envConfig = getCurrentConfig()
        const tokenStore = createTokenStore()
        const globalConfigStore = new FileGlobalConfigStore()
        const trackingService = new MixpanelTrackingService({globalConfigStore, tokenStore})
        const contextTreeSnapshotService = new FileContextTreeSnapshotService()

        const useCase = new PullUseCase({
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

        await useCase.run({
          branch: parsed.flags.branch ?? DEFAULT_BRANCH,
        })
      },
      type: 'streaming',
    }
  },
  aliases: [],
  autoExecute: true,
  description: 'Pull context tree from ByteRover memory storage',
  flags: toCommandFlags(pullFlags),
  kind: CommandKind.BUILT_IN,
  name: 'pull',
}
