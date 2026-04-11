import React from 'react'

import type {IVcCheckoutRequest} from '../../../../shared/transport/events/vc-events.js'
import type {SlashCommand} from '../../../types/commands.js'

import {VcCheckoutFlow} from '../../vc/checkout/components/vc-checkout-flow.js'
import {Args, Flags, parseReplArgs, toCommandFlags} from '../utils/arg-parser.js'

const vcCheckoutArgs = {
  branch: Args.string({description: 'Branch to switch to', required: true}),
}

const vcCheckoutFlags = {
  create: Flags.boolean({char: 'b', default: false, description: 'Create a new branch and switch to it'}),
  force: Flags.boolean({default: false, description: 'Discard local changes and switch'}),
}

function resolveRequest(parsed: {
  args: {branch?: string}
  flags: {create?: boolean; force?: boolean}
}): IVcCheckoutRequest {
  if (!parsed.args.branch) throw new Error('Branch name is required.')

  return {
    branch: parsed.args.branch,
    create: parsed.flags.create,
    force: parsed.flags.force,
  }
}

export const vcCheckoutSubCommand: SlashCommand = {
  async action(_context, rawArgs) {
    const parsed = await parseReplArgs(rawArgs, {args: vcCheckoutArgs, flags: vcCheckoutFlags, strict: false})
    const request = resolveRequest(parsed)

    return {
      render: ({onCancel, onComplete}) => React.createElement(VcCheckoutFlow, {onCancel, onComplete, request}),
    }
  },
  args: [{description: 'Branch to switch to', name: 'branch', required: true}],
  description: 'Switch to an existing branch, or create and switch with -b',
  flags: toCommandFlags(vcCheckoutFlags),
  name: 'checkout',
}
