import type {MessageActionReturn, SlashCommand} from '../../../types/commands.js'

import {getStatus} from '../../status/api/get-status.js'

export const spaceListCommand: SlashCommand = {
  async action() {
    const {status} = await getStatus()
    const isVc = status.contextTreeStatus === 'git_vc'

    const content = isVc
      ? 'The space list command has been deprecated. Visit the ByteRover web dashboard to view your spaces.'
      : 'The space list command has been deprecated. Visit the ByteRover web dashboard to view your spaces and follow the migration guide to version control.'

    return {content, messageType: 'error', type: 'message'} satisfies MessageActionReturn
  },
  description: 'List all spaces (deprecated)',
  name: 'list',
}
