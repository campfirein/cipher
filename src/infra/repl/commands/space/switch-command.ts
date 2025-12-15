import {getCurrentConfig} from '../../../../config/environment.js'
import {type CommandContext, CommandKind, type SlashCommand} from '../../../../tui/types.js'
import {ProjectConfigStore} from '../../../config/file-config-store.js'
import {HttpSpaceService} from '../../../space/http-space-service.js'
import {KeychainTokenStore} from '../../../storage/keychain-token-store.js'
import {HttpTeamService} from '../../../team/http-team-service.js'
import {ReplTerminal} from '../../../terminal/repl-terminal.js'
import {SpaceSwitchUseCase} from '../../../usecase/space-switch-use-case.js'
import {WorkspaceDetectorService} from '../../../workspace/workspace-detector-service.js'

/**
 * Switch space command
 */
export const switchCommand: SlashCommand = {
  action(_context: CommandContext, _args: string) {
    return {
      async execute(onMessage, onPrompt) {
        const terminal = new ReplTerminal({onMessage, onPrompt})
        const envConfig = getCurrentConfig()

        const useCase = new SpaceSwitchUseCase({
          projectConfigStore: new ProjectConfigStore(),
          spaceService: new HttpSpaceService({apiBaseUrl: envConfig.apiBaseUrl}),
          teamService: new HttpTeamService({apiBaseUrl: envConfig.apiBaseUrl}),
          terminal,
          tokenStore: new KeychainTokenStore(),
          workspaceDetector: new WorkspaceDetectorService(),
        })

        await useCase.run()
      },
      type: 'streaming',
    }
  },
  aliases: [],
  autoExecute: true,
  description: 'Switch to a different space',
  kind: CommandKind.BUILT_IN,
  name: 'switch',
}
