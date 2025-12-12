import {Command} from '@oclif/core'

import type {ISpaceSwitchUseCase} from '../../core/interfaces/usecase/i-space-switch-use-case.js'

import {getCurrentConfig} from '../../config/environment.js'
import {BRV_DIR, PROJECT_CONFIG_FILE} from '../../constants.js'
import {ProjectConfigStore} from '../../infra/config/file-config-store.js'
import {HttpSpaceService} from '../../infra/space/http-space-service.js'
import {KeychainTokenStore} from '../../infra/storage/keychain-token-store.js'
import {HttpTeamService} from '../../infra/team/http-team-service.js'
import {OclifTerminal} from '../../infra/terminal/oclif-terminal.js'
import {SpaceSwitchUseCase} from '../../infra/usecase/space-switch-use-case.js'
import {WorkspaceDetectorService} from '../../infra/workspace/workspace-detector-service.js'

export default class SpaceSwitch extends Command {
  public static description = `Switch to a different team or space (updates ${BRV_DIR}/${PROJECT_CONFIG_FILE})`
  public static examples = [
    '<%= config.bin %> <%= command.id %>',
    '# Shows current configuration, then prompts for new team/space selection',
  ]

  protected createUseCase(): ISpaceSwitchUseCase {
    const envConfig = getCurrentConfig()
    return new SpaceSwitchUseCase({
      projectConfigStore: new ProjectConfigStore(),
      spaceService: new HttpSpaceService({apiBaseUrl: envConfig.apiBaseUrl}),
      teamService: new HttpTeamService({apiBaseUrl: envConfig.apiBaseUrl}),
      terminal: new OclifTerminal(this),
      tokenStore: new KeychainTokenStore(),
      workspaceDetector: new WorkspaceDetectorService(),
    })
  }

  public async run(): Promise<void> {
    await this.createUseCase().run()
  }
}
