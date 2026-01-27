import {getCurrentConfig} from '../../../server/config/environment.js'
import {ProjectConfigStore} from '../../../server/infra/config/file-config-store.js'
import {HttpSpaceService} from '../../../server/infra/space/http-space-service.js'
import {createTokenStore} from '../../../server/infra/storage/token-store.js'
import {HttpTeamService} from '../../../server/infra/team/http-team-service.js'
import {ReplTerminal} from '../../../server/infra/terminal/repl-terminal.js'
import {SpaceSwitchUseCase} from '../../../server/infra/usecase/space-switch-use-case.js'
import {WorkspaceDetectorService} from '../../../server/infra/workspace/workspace-detector-service.js'
import {CommandContext, CommandKind, SlashCommand} from '../../types.js'

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
          tokenStore: createTokenStore(),
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
