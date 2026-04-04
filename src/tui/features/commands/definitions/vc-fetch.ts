import React from 'react'

import type {MessageActionReturn, SlashCommand} from '../../../types/commands.js'

import {VcFetchFlow} from '../../vc/fetch/components/vc-fetch-flow.js'
import {Args, parseReplArgs} from '../utils/arg-parser.js'

/* eslint-disable perfectionist/sort-objects -- positional order matters: remote before branch */
const vcFetchArgs = {
  remote: Args.string({description: 'Remote name (only origin supported)'}),
  branch: Args.string({description: 'Branch to fetch'}),
}
/* eslint-enable perfectionist/sort-objects */

export const vcFetchSubCommand: SlashCommand = {
  async action(_context, rawArgs) {
    const parsed = await parseReplArgs(rawArgs, {args: vcFetchArgs, strict: false})
    const {branch, remote} = parsed.args

    if (remote && remote !== 'origin') {
      const errorMsg: MessageActionReturn = {
        content: `Only 'origin' remote is currently supported.`,
        messageType: 'error',
        type: 'message',
      }
      return errorMsg
    }

    return {
      render: ({onCancel, onComplete}) =>
        React.createElement(VcFetchFlow, {
          onCancel,
          onComplete,
          ref: branch,
          remote,
        }),
    }
  },
  args: [
    {description: 'Remote name (only origin supported)', name: 'remote', required: false},
    {description: 'Branch to fetch', name: 'branch', required: false},
  ],
  description: 'Fetch refs from ByteRover cloud',
  name: 'fetch',
}
