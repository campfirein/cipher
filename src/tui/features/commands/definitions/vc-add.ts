import React from 'react'

import type {SlashCommand} from '../../../types/commands.js'

import {VcAddFlow} from '../../vc/add/components/vc-add-flow.js'
import {parseReplArgs} from '../utils/arg-parser.js'

export const vcAddSubCommand: SlashCommand = {
  async action(_context, rawArgs) {
    const parsed = await parseReplArgs(rawArgs, {strict: false})
    // argv contains all non-flag tokens; default to '.' like git add .
    const filePaths = parsed.argv.length > 0 ? parsed.argv : ['.']

    return {
      render: ({onCancel, onComplete}) => React.createElement(VcAddFlow, {filePaths, onCancel, onComplete}),
    }
  },
  description: 'Stage files for the next commit',
  name: 'add',
}
