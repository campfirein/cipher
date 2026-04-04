import React from 'react'

import type {SlashCommand} from '../../../types/commands.js'

import {VcCloneFlow} from '../../vc/clone/components/vc-clone-flow.js'
import {Args, parseReplArgs} from '../utils/arg-parser.js'

const vcCloneArgs = {
  url: Args.string({description: 'Clone URL (optional — prompts for URL if omitted)'}),
}

export const vcCloneSubCommand: SlashCommand = {
  async action(_context, rawArgs) {
    const parsed = await parseReplArgs(rawArgs, {args: vcCloneArgs, strict: false})
    const {url} = parsed.args

    return {
      render: ({onCancel, onComplete}) => React.createElement(VcCloneFlow, {onCancel, onComplete, url}),
    }
  },
  args: [{description: 'Clone URL (optional)', name: 'url'}],
  description: 'Clone a ByteRover space repository',
  name: 'clone',
}
