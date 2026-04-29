import React from 'react'

import type {SlashCommand} from '../../../types/commands.js'

import {VcDiffFlow} from '../../vc/diff/components/vc-diff-flow.js'
import {parseMode} from '../../vc/diff/utils/parse-mode.js'
import {Args, Flags, parseReplArgs, toCommandFlags} from '../utils/arg-parser.js'

const vcDiffArgs = {
  ref: Args.string({description: 'commit, branch, or <ref1>..<ref2> range'}),
}

const vcDiffFlags = {
  staged: Flags.boolean({default: false, description: 'Show staged changes (HEAD vs index)'}),
}

export const vcDiffSubCommand: SlashCommand = {
  async action(_context, args) {
    const parsed = await parseReplArgs(args, {args: vcDiffArgs, flags: vcDiffFlags, strict: false})
    const mode = parseMode(parsed.args.ref, parsed.flags.staged ?? false)

    return {
      render: ({onCancel, onComplete}) => React.createElement(VcDiffFlow, {mode, onCancel, onComplete}),
    }
  },
  args: [{description: 'commit, branch, or <ref1>..<ref2> range', name: 'ref'}],
  description: 'Show changes between commits, the index, or the working tree',
  flags: toCommandFlags(vcDiffFlags),
  name: 'diff',
}
