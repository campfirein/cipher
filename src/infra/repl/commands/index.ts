import {SlashCommand} from '../../../tui/types.js'
import {clearCommand} from './clear-command.js'
import {curateCommand} from './curate-command.js'
import {genRulesCommand} from './gen-rules-command.js'
import {initCommand} from './init-command.js'
import {loginCommand} from './login-command.js'
import {logoutCommand} from './logout-command.js'
import {pullCommand} from './pull-command.js'
import {pushCommand} from './push-command.js'
import {queryCommand} from './query-command.js'
import {spaceCommand} from './space/index.js'
import {statusCommand} from './status-command.js'

export const load: () => SlashCommand[] = () => [
  spaceCommand,
  clearCommand,
  curateCommand,
  genRulesCommand,
  initCommand,
  loginCommand,
  logoutCommand,
  pullCommand,
  pushCommand,
  queryCommand,
  statusCommand,
]
