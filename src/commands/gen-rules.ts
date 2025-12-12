import {Command} from '@oclif/core'

import type {IGenerateRulesUseCase} from '../core/interfaces/usecase/i-generate-rules-use-case.js'

import {FsFileService} from '../infra/file/fs-file-service.js'
import {LegacyRuleDetector} from '../infra/rule/legacy-rule-detector.js'
import {RuleTemplateService} from '../infra/rule/rule-template-service.js'
import {KeychainTokenStore} from '../infra/storage/keychain-token-store.js'
import {FsTemplateLoader} from '../infra/template/fs-template-loader.js'
import {OclifTerminal} from '../infra/terminal/oclif-terminal.js'
import {MixpanelTrackingService} from '../infra/tracking/mixpanel-tracking-service.js'
import {GenerateRulesUseCase} from '../infra/usecase/generate-rules-use-case.js'

export default class GenRules extends Command {
  static override description = 'Generate rule instructions for coding agents to work with ByteRover correctly'
  static override examples = ['<%= config.bin %> <%= command.id %>']

  protected createUseCase(): IGenerateRulesUseCase {
    const fileService = new FsFileService()
    const templateLoader = new FsTemplateLoader(fileService)
    const templateService = new RuleTemplateService(templateLoader)

    return new GenerateRulesUseCase(
      fileService,
      new LegacyRuleDetector(),
      templateService,
      new OclifTerminal(this),
      new MixpanelTrackingService(new KeychainTokenStore()),
    )
  }

  public async run(): Promise<void> {
    await this.createUseCase().run()
  }
}
