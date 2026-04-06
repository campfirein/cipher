import type {MessageActionReturn, SlashCommand} from '../../../types/commands.js'

import {getStatus} from '../../status/api/get-status.js'

export const spaceSwitchCommand: SlashCommand = {
  async action() {
    const {status} = await getStatus()
    const isVc = status.contextTreeStatus === 'git_vc'

    const content = isVc
      ? 'The space switch command has been deprecated. To work with a different space, use: brv vc clone <url>'
      : 'The space switch command has been deprecated. Visit the ByteRover web dashboard to follow the migration guide from snapshot to version control.'

    return {content, messageType: 'error', type: 'message'} satisfies MessageActionReturn
  },
  description: 'Switch to a different space (deprecated)',
  name: 'switch',
}
