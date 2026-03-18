import React from 'react'

import type {SlashCommand} from '../../../types/commands.js'

import {VcPushFlow} from '../../vc/push/components/vc-push-flow.js'
import {Flags, parseReplArgs, toCommandFlags} from '../utils/arg-parser.js'

const vcPushFlags = {
  'set-upstream': Flags.boolean({char: 'u', description: 'Set upstream tracking branch'}),
}

export const vcPushSubCommand: SlashCommand = {
  async action(_context, rawArgs) {
    const parsed = await parseReplArgs(rawArgs, {flags: vcPushFlags, strict: false})
    const {'set-upstream': setUpstream} = parsed.flags
    const positional = parsed.argv ?? []

    // Git push semantics: push [<remote> [<branch>]]
    //   /vc push                → current branch
    //   /vc push origin         → current branch (explicit remote)
    //   /vc push origin feat/x  → feat/x
    //   /vc push feat/x         → error (unknown remote)
    let branch: string | undefined
    if (positional.length >= 2) {
      if (positional[0] !== 'origin') {
        throw new Error(`Unknown remote '${positional[0]}'.`)
      }

      branch = positional[1]
    } else if (positional.length === 1 && positional[0] !== 'origin') {
      throw new Error(`Unknown remote '${positional[0]}'. Use '/vc push origin ${positional[0]}' to push a specific branch.`)
    }

    return {
      render: ({onCancel, onComplete}) => React.createElement(VcPushFlow, {branch, onCancel, onComplete, setUpstream}),
    }
  },
  args: [
    {description: 'Remote name (e.g. origin)', name: 'remote', required: false},
    {description: 'Branch to push to', name: 'branch', required: false},
  ],
  description: 'Push commits to ByteRover cloud',
  flags: toCommandFlags(vcPushFlags),
  name: 'push',
}
