import React from 'react'

import type {IVcRmRequest} from '../../../../shared/transport/events/vc-events.js'
import type {SlashCommand} from '../../../types/commands.js'

import {VcRmFlow} from '../../vc/rm/components/vc-rm-flow.js'
import {Flags, parseReplArgs, toCommandFlags} from '../utils/arg-parser.js'

const vcRmFlags = {
  cached: Flags.boolean({description: 'Only remove from the index; keep the working-tree file'}),
  'dry-run': Flags.boolean({char: 'n', description: 'Print what would be removed without changing anything'}),
  force: Flags.boolean({char: 'f', description: 'Override the up-to-date check'}),
  'ignore-unmatch': Flags.boolean({description: 'Exit with zero status even when no files match'}),
  'pathspec-file-nul': Flags.boolean({
    dependsOn: ['pathspec-from-file'],
    description: 'With --pathspec-from-file, pathspec elements are separated with NUL',
  }),
  'pathspec-from-file': Flags.string({
    description: 'Read pathspec from <file>; one per line (or NUL with --pathspec-file-nul)',
  }),
  quiet: Flags.boolean({char: 'q', description: 'Suppress per-file output'}),
  recursive: Flags.boolean({char: 'r', description: 'Allow recursive removal of directories'}),
}

export const vcRmSubCommand: SlashCommand = {
  async action(_context, rawArgs) {
    const parsed = await parseReplArgs(rawArgs, {flags: vcRmFlags, strict: false})
    const filePaths = parsed.argv.filter((a): a is string => typeof a === 'string')

    const request: IVcRmRequest = {
      cached: parsed.flags.cached ?? undefined,
      dryRun: parsed.flags['dry-run'] ?? undefined,
      filePaths,
      force: parsed.flags.force ?? undefined,
      ignoreUnmatch: parsed.flags['ignore-unmatch'] ?? undefined,
      pathspecFileNul: parsed.flags['pathspec-file-nul'] ?? undefined,
      pathspecFromFile: parsed.flags['pathspec-from-file'],
      quiet: parsed.flags.quiet ?? undefined,
      recursive: parsed.flags.recursive ?? undefined,
    }

    return {
      render: ({onCancel, onComplete}) => React.createElement(VcRmFlow, {onCancel, onComplete, request}),
    }
  },
  args: [{description: 'Files or directories to remove', name: 'paths', required: false}],
  description: 'Remove files from the working tree and the index',
  flags: toCommandFlags(vcRmFlags),
  name: 'rm',
}
