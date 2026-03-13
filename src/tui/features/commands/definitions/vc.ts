import type {SlashCommand} from '../../../types/commands.js'

import {vcAddSubCommand} from './vc-add.js'
import {vcBranchSubCommand} from './vc-branch.js'
import {vcCloneSubCommand} from './vc-clone.js'
import {vcCommitSubCommand} from './vc-commit.js'
import {vcConfigSubCommand} from './vc-config.js'
import {vcInitSubCommand} from './vc-init.js'
import {vcLogSubCommand} from './vc-log.js'
import {vcPullSubCommand} from './vc-pull.js'
import {vcPushSubCommand} from './vc-push.js'
import {vcRemoteSubCommand} from './vc-remote.js'
import {vcStatusSubCommand} from './vc-status.js'

export const vcCommand: SlashCommand = {
  description: 'Version control commands for ByteRover',
  name: 'vc',
  subCommands: [
    vcCloneSubCommand,
    vcInitSubCommand,
    vcAddSubCommand,
    vcCommitSubCommand,
    vcPullSubCommand,
    vcPushSubCommand,
    vcStatusSubCommand,
    vcLogSubCommand,
    vcBranchSubCommand,
    vcConfigSubCommand,
    vcRemoteSubCommand,
  ],
}
