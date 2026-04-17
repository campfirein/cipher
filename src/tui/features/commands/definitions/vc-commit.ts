import React from 'react'

import type {MessageActionReturn, SlashCommand} from '../../../types/commands.js'

import {VcCommitFlow} from '../../vc/commit/components/vc-commit-flow.js'
import {Flags, parseReplArgs, toCommandFlags} from '../utils/arg-parser.js'

const vcCommitFlags = {
  message: Flags.string({char: 'm', description: 'Commit message'}),
}

export const vcCommitSubCommand: SlashCommand = {
  async action(_context, rawArgs) {
    const parsed = await parseReplArgs(rawArgs, {flags: vcCommitFlags, strict: false})
    // Join remaining argv with the flag value to support unquoted multi-word messages
    // e.g. /vc commit -m hello world → message = "hello world"
    // e.g. /vc commit hello world    → message = "hello world"
    const extra = parsed.argv.join(' ')
    const message = parsed.flags.message
      ? (extra ? `${parsed.flags.message} ${extra}` : parsed.flags.message)
      : (extra || undefined)

    if (!message) {
      const errorMsg: MessageActionReturn = {
        content: 'Usage: /vc commit -m "<message>"',
        messageType: 'error',
        type: 'message',
      }
      return errorMsg
    }

    return {
      render: ({onCancel, onComplete}) => React.createElement(VcCommitFlow, {message, onCancel, onComplete}),
    }
  },
  description: 'Save staged changes as a commit',
  flags: toCommandFlags(vcCommitFlags),
  name: 'commit',
}
