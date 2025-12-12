import {Command, Flags} from '@oclif/core'

import type {ISpaceListUseCase} from '../../core/interfaces/usecase/i-space-list-use-case.js'

import {getCurrentConfig} from '../../config/environment.js'
import {ProjectConfigStore} from '../../infra/config/file-config-store.js'
import {HttpSpaceService} from '../../infra/space/http-space-service.js'
import {KeychainTokenStore} from '../../infra/storage/keychain-token-store.js'
import {OclifTerminal} from '../../infra/terminal/oclif-terminal.js'
import {SpaceListUseCase} from '../../infra/usecase/space-list-use-case.js'

const DEFAULT_LIMIT = 50
const DEFAULT_OFFSET = 0

export default class SpaceList extends Command {
  public static description = 'List all spaces for the current team (requires project initialization)'
  public static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --all',
    '<%= config.bin %> <%= command.id %> --limit 10',
    '<%= config.bin %> <%= command.id %> --limit 10 --offset 20',
    '<%= config.bin %> <%= command.id %> --json',
  ]
  public static flags = {
    all: Flags.boolean({
      char: 'a',
      default: false,
      description: 'Fetch all spaces (may be slow for large teams)',
    }),
    json: Flags.boolean({
      char: 'j',
      default: false,
      description: 'Output in JSON format',
    }),
    limit: Flags.integer({
      char: 'l',
      default: DEFAULT_LIMIT,
      description: 'Maximum number of spaces to fetch',
    }),
    offset: Flags.integer({
      char: 'o',
      default: DEFAULT_OFFSET,
      description: 'Number of spaces to skip',
    }),
  }

  protected createUseCase(flags: {all: boolean; json: boolean; limit: number; offset: number}): ISpaceListUseCase {
    const envConfig = getCurrentConfig()
    return new SpaceListUseCase({
      flags,
      projectConfigStore: new ProjectConfigStore(),
      spaceService: new HttpSpaceService({apiBaseUrl: envConfig.apiBaseUrl}),
      terminal: new OclifTerminal(this),
      tokenStore: new KeychainTokenStore(),
    })
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(SpaceList)
    await this.createUseCase(flags).run()
  }
}
