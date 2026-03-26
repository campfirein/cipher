import React from 'react'

import type {MessageActionReturn, SlashCommand} from '../../../types/commands.js'

import {isVcRemoteSubcommand} from '../../../../shared/transport/events/vc-events.js'
import {VcRemoteFlow} from '../../vc/remote/components/vc-remote-flow.js'
import {Args, parseReplArgs} from '../utils/arg-parser.js'

const vcRemoteArgs = {
  subcommand: Args.string({description: 'Subcommand: add | set-url (omit to show current remote)'}),
  url: Args.string({description: 'Remote URL (e.g. https://cogit.byterover.dev/team/space.brv)'}),
}

export const vcRemoteSubCommand: SlashCommand = {
  async action(_context, rawArgs) {
    const parsed = await parseReplArgs(rawArgs, {args: vcRemoteArgs, strict: false})
    const {subcommand: rawSubcommand, url} = parsed.args

    if (!rawSubcommand) {
      return {
        render: ({onCancel, onComplete}) =>
          React.createElement(VcRemoteFlow, {onCancel, onComplete, subcommand: 'show'}),
      }
    }

    if (!isVcRemoteSubcommand(rawSubcommand)) {
      const errorMsg: MessageActionReturn = {
        content: `Unknown subcommand '${rawSubcommand}'. Usage: /vc remote [add|set-url] <url>`,
        messageType: 'error',
        type: 'message',
      }
      return errorMsg
    }

    if (!url) {
      const errorMsg: MessageActionReturn = {
        content: `Usage: /vc remote ${rawSubcommand} <url>`,
        messageType: 'error',
        type: 'message',
      }
      return errorMsg
    }

    return {
      render: ({onCancel, onComplete}) =>
        React.createElement(VcRemoteFlow, {onCancel, onComplete, subcommand: rawSubcommand, url}),
    }
  },
  args: [
    {description: 'Subcommand: add | set-url (omit to show current remote)', name: 'subcommand'},
    {description: 'Remote URL', name: 'url'},
  ],
  description: 'Manage remote origin for ByteRover version control',
  name: 'remote',
}
