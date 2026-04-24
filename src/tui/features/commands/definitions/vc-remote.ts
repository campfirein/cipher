import React from 'react'

import type {MessageActionReturn, SlashCommand} from '../../../types/commands.js'

import {isVcRemoteSubcommand, VC_REMOTE_SUBCOMMAND_REQUIRES_URL} from '../../../../shared/transport/events/vc-events.js'
import {getGitRemoteBaseUrl} from '../../../lib/environment.js'
import {VcRemoteFlow} from '../../vc/remote/components/vc-remote-flow.js'
import {Args, parseReplArgs} from '../utils/arg-parser.js'

/* eslint-disable perfectionist/sort-objects -- positional order matters: subcommand, name, url */
const vcRemoteArgs = {
  subcommand: Args.string({description: 'Subcommand: add | set-url | remove (omit to show current remote)'}),
  name: Args.string({description: 'Remote name (e.g. origin)'}),
  url: Args.string({description: `Remote URL (e.g. ${getGitRemoteBaseUrl()}/<team>/<space>.git)`}),
}
/* eslint-enable perfectionist/sort-objects */

export const vcRemoteSubCommand: SlashCommand = {
  async action(_context, rawArgs) {
    const parsed = await parseReplArgs(rawArgs, {args: vcRemoteArgs, strict: false})
    const {name, subcommand: rawSubcommand, url} = parsed.args

    if (!rawSubcommand) {
      return {
        render: ({onCancel, onComplete}) =>
          React.createElement(VcRemoteFlow, {onCancel, onComplete, subcommand: 'show'}),
      }
    }

    if (!isVcRemoteSubcommand(rawSubcommand)) {
      const errorMsg: MessageActionReturn = {
        content: `Unknown subcommand '${rawSubcommand}'. Usage: /vc remote [add|set-url|remove] <name> [url]`,
        messageType: 'error',
        type: 'message',
      }
      return errorMsg
    }

    const requiresUrl = VC_REMOTE_SUBCOMMAND_REQUIRES_URL[rawSubcommand]

    if (!name || (requiresUrl && !url)) {
      const usage = requiresUrl
        ? `Usage: /vc remote ${rawSubcommand} <name> <url>`
        : `Usage: /vc remote ${rawSubcommand} <name>`
      const errorMsg: MessageActionReturn = {
        content: usage,
        messageType: 'error',
        type: 'message',
      }
      return errorMsg
    }

    if (name !== 'origin') {
      const errorMsg: MessageActionReturn = {
        content: `Only 'origin' remote is currently supported.`,
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
    {description: 'Subcommand: add | set-url | remove (omit to show current remote)', name: 'subcommand'},
    {description: 'Remote name (e.g. origin)', name: 'name'},
    {description: 'Remote URL (required for add | set-url)', name: 'url'},
  ],
  description: 'Manage remote origin for ByteRover version control',
  name: 'remote',
}
