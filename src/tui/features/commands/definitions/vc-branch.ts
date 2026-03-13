import React from 'react'

import type {IVcBranchRequest} from '../../../../shared/transport/events/vc-events.js'
import type {SlashCommand} from '../../../types/commands.js'

import {VcBranchFlow} from '../../vc/branch/components/vc-branch-flow.js'
import {Args, Flags, parseReplArgs, toCommandFlags} from '../utils/arg-parser.js'

const vcBranchArgs = {
  name: Args.string({description: 'Branch name to create'}),
}

const vcBranchFlags = {
  all: Flags.boolean({char: 'a', default: false, description: 'List all branches including remote-tracking'}),
  delete: Flags.string({char: 'd', description: 'Delete a branch by name'}),
}

function resolveRequest(parsed: {args: {name?: string}; flags: {all?: boolean; delete?: string}}): IVcBranchRequest {
  if (parsed.flags.delete) return {action: 'delete', name: parsed.flags.delete}
  if (parsed.args.name) return {action: 'create', name: parsed.args.name}
  return {action: 'list', all: parsed.flags.all}
}

export const vcBranchSubCommand: SlashCommand = {
  async action(_context, rawArgs) {
    const parsed = await parseReplArgs(rawArgs, {args: vcBranchArgs, flags: vcBranchFlags, strict: false})
    const request = resolveRequest(parsed)

    return {
      render: ({onCancel, onComplete}) => React.createElement(VcBranchFlow, {onCancel, onComplete, request}),
    }
  },
  args: [{description: 'Branch name to create', name: 'name'}],
  description: 'List, create, or delete local branches',
  flags: toCommandFlags(vcBranchFlags),
  name: 'branch',
}
