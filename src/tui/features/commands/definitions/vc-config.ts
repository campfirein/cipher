import React from 'react'

import type {MessageActionReturn, SlashCommand} from '../../../types/commands.js'

import {isVcConfigKey} from '../../../../shared/transport/events/vc-events.js'
import {VcConfigFlow} from '../../vc/config/components/vc-config-flow.js'
import {Args, parseReplArgs} from '../utils/arg-parser.js'

const vcConfigArgs = {
  key: Args.string({description: 'Config key (user.name or user.email)'}),
  value: Args.string({description: 'Config value to set (omit to get current value)'}),
}

export const vcConfigSubCommand: SlashCommand = {
  async action(_context, rawArgs) {
    const parsed = await parseReplArgs(rawArgs, {args: vcConfigArgs, strict: false})
    const {key} = parsed.args
    const {value} = parsed.args

    if (!key) {
      const errorMsg: MessageActionReturn = {
        content: 'Usage: /vc config user.name "<value>" | /vc config user.email "<value>"',
        messageType: 'error',
        type: 'message',
      }
      return errorMsg
    }

    if (!isVcConfigKey(key)) {
      const errorMsg: MessageActionReturn = {
        content: `Unknown key '${key}'. Allowed: user.name, user.email.`,
        messageType: 'error',
        type: 'message',
      }
      return errorMsg
    }

    return {
      render: ({onCancel, onComplete}) =>
        React.createElement(VcConfigFlow, {configKey: key, onCancel, onComplete, value}),
    }
  },
  args: [
    {description: 'Config key (user.name or user.email)', name: 'key'},
    {description: 'Value to set (omit to read current value)', name: 'value'},
  ],
  description: 'Get or set commit author for ByteRover version control',
  name: 'config',
}
