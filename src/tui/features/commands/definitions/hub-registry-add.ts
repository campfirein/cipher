import React from 'react'

import type {SlashCommand} from '../../../types/commands.js'

import {HubRegistryAddView} from '../../hub/components/hub-registry-add-view.js'
import {Args, Flags, parseReplArgs, toCommandFlags} from '../utils/arg-parser.js'

const addArgs = {
  name: Args.string({description: 'Registry name', required: true}),
}

const addFlags = {
  'auth-scheme': Flags.string({char: 's', description: 'Auth scheme (bearer, token, basic, custom-header, none)'}),
  'header-name': Flags.string({description: 'Custom header name (for custom-header scheme)'}),
  token: Flags.string({char: 't', description: 'Auth token for private registry'}),
  url: Flags.string({char: 'u', description: 'Registry URL', required: true}),
}

export const hubRegistryAddCommand: SlashCommand = {
  async action(_context, args) {
    const parsed = await parseReplArgs(args, {args: addArgs, flags: addFlags, strict: false})
    const name = parsed.args.name as string | undefined
    const url = parsed.flags.url as string | undefined
    const token = parsed.flags.token as string | undefined
    const authScheme = parsed.flags['auth-scheme'] as string | undefined
    const headerName = parsed.flags['header-name'] as string | undefined

    if (!name || !url) {
      return {
        content: 'Usage: /hub registry add <name> --url <url> [--token <token>] [--auth-scheme <scheme>]',
        messageType: 'error' as const,
        type: 'message' as const,
      }
    }

    return {
      render: ({onCancel, onComplete}) =>
        React.createElement(HubRegistryAddView, {authScheme, headerName, name, onCancel, onComplete, token, url}),
    }
  },
  args: [{description: 'Registry name', name: 'name', required: true}],
  description: 'Add a hub registry',
  flags: toCommandFlags(addFlags),
  name: 'add',
}
