import {Command, Flags} from '@oclif/core'

import type {IInitUseCase} from '../core/interfaces/usecase/i-init-use-case.js'

import {getCurrentConfig} from '../config/environment.js'
import {BRV_DIR, PROJECT_CONFIG_FILE} from '../constants.js'
import {HttpCogitPullService} from '../infra/cogit/http-cogit-pull-service.js'
import {ProjectConfigStore} from '../infra/config/file-config-store.js'
import {FileContextTreeService} from '../infra/context-tree/file-context-tree-service.js'
import {FileContextTreeSnapshotService} from '../infra/context-tree/file-context-tree-snapshot-service.js'
import {FileContextTreeWriterService} from '../infra/context-tree/file-context-tree-writer-service.js'
import {FsFileService} from '../infra/file/fs-file-service.js'
import {LegacyRuleDetector} from '../infra/rule/legacy-rule-detector.js'
import {RuleTemplateService} from '../infra/rule/rule-template-service.js'
import {HttpSpaceService} from '../infra/space/http-space-service.js'
import {KeychainTokenStore} from '../infra/storage/keychain-token-store.js'
import {HttpTeamService} from '../infra/team/http-team-service.js'
import {FsTemplateLoader} from '../infra/template/fs-template-loader.js'
import {OclifTerminal} from '../infra/terminal/oclif-terminal.js'
import {MixpanelTrackingService} from '../infra/tracking/mixpanel-tracking-service.js'
import {InitUseCase} from '../infra/usecase/init-use-case.js'

export default class Init extends Command {
  public static description = `Initialize a project with ByteRover (creates ${BRV_DIR}/${PROJECT_CONFIG_FILE} with team/space selection and initializes Context Tree)`
  public static examples = [
    '<%= config.bin %> <%= command.id %>',
    '# Re-initialize if config exists (will show current config and exit):\n<%= config.bin %> <%= command.id %>',
    '# Full workflow: login then initialize:\n<%= config.bin %> login\n<%= config.bin %> <%= command.id %>',
  ]
  public static flags = {
    force: Flags.boolean({
      char: 'f',
      default: false,
      description: 'Force re-initialization without confirmation prompt',
    }),
  }

  protected createUseCase(): IInitUseCase {
    const envConfig = getCurrentConfig()
    const tokenStore = new KeychainTokenStore()
    const trackingService = new MixpanelTrackingService(tokenStore)

    const fileService = new FsFileService()
    const templateLoader = new FsTemplateLoader(fileService)
    const ruleTemplateService = new RuleTemplateService(templateLoader)

    const legacyRuleDetector = new LegacyRuleDetector()

    const contextTreeSnapshotService = new FileContextTreeSnapshotService()

    return new InitUseCase({
      cogitPullService: new HttpCogitPullService({
        apiBaseUrl: envConfig.cogitApiBaseUrl,
      }),
      contextTreeService: new FileContextTreeService(),
      contextTreeSnapshotService,
      contextTreeWriterService: new FileContextTreeWriterService({snapshotService: contextTreeSnapshotService}),
      fileService,
      legacyRuleDetector,
      projectConfigStore: new ProjectConfigStore(),
      spaceService: new HttpSpaceService({
        apiBaseUrl: envConfig.apiBaseUrl,
      }),
      teamService: new HttpTeamService({
        apiBaseUrl: envConfig.apiBaseUrl,
      }),
      templateService: ruleTemplateService,
      terminal: new OclifTerminal(this),
      tokenStore,
      trackingService,
    })
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(Init)
    await this.createUseCase().run({force: flags.force})
  }
}
