import chalk from 'chalk'

import type {IVcBranchResponse} from '../../../../../shared/transport/events/vc-events.js'

export function formatBranchList(branches: Extract<IVcBranchResponse, {action: 'list'}>['branches']): string {
  if (branches.length === 0) return 'No branches found.'

  return branches
    .map((b) => {
      const prefix = b.isCurrent ? '* ' : '  '
      const name = b.isRemote ? `remotes/${b.name}` : b.name
      return b.isCurrent ? `${prefix}${chalk.green(name)}` : `${prefix}${name}`
    })
    .join('\n')
}
