/**
 * Pure formatting function for CLI status output.
 */

import chalk from 'chalk'

import type {GitChanges, StatusDTO} from '../../../../shared/transport/types/dto.js'

function formatGitChanges(changes: GitChanges, relativeDir: string): string[] {
  const result: string[] = []
  const fp = (file: string) => `${relativeDir}/${file}`
  const {staged, unstaged, untracked} = changes

  if (staged.added.length > 0 || staged.modified.length > 0 || staged.deleted.length > 0) {
    result.push('Changes to be committed:')
    for (const f of staged.added) result.push(`   ${chalk.green(`new file:   ${fp(f)}`)}`)
    for (const f of staged.modified) result.push(`   ${chalk.green(`modified:   ${fp(f)}`)}`)
    for (const f of staged.deleted) result.push(`   ${chalk.green(`deleted:    ${fp(f)}`)}`)
  }

  if (unstaged.modified.length > 0 || unstaged.deleted.length > 0) {
    result.push('Changes not staged for commit:')
    for (const f of unstaged.modified) result.push(`   ${chalk.red(`modified:   ${fp(f)}`)}`)
    for (const f of unstaged.deleted) result.push(`   ${chalk.red(`deleted:    ${fp(f)}`)}`)
  }

  if (untracked.length > 0) {
    result.push('Untracked files:')
    for (const f of untracked) result.push(`   ${chalk.red(fp(f))}`)
  }

  return result
}

export function formatStatus(status: StatusDTO, version?: string): string {
  const lines: string[] = []

  lines.push(`CLI Version: ${version ?? ''}`)

  switch (status.authStatus) {
    case 'expired': {
      lines.push('Account: Session expired')
      break
    }

    case 'logged_in': {
      lines.push(`Account: ${status.userEmail}`)
      break
    }

    case 'not_logged_in': {
      lines.push('Account: Not logged in')
      break
    }

    default: {
      lines.push('Account: Unable to check')
    }
  }

  lines.push(`Current Directory: ${status.currentDirectory}`)

  if (status.teamName && status.spaceName) {
    lines.push(`Space: ${status.teamName}/${status.spaceName}`)
  } else {
    lines.push('Space: Not connected')
  }

  if (status.gitBranch) {
    lines.push(`On branch: ${status.gitBranch}`)
  }

  switch (status.contextTreeStatus) {
    case 'has_changes': {
      if (status.gitChanges && status.contextTreeRelativeDir) {
        lines.push(...formatGitChanges(status.gitChanges, status.contextTreeRelativeDir))
      }

      break
    }

    case 'no_changes': {
      lines.push('Context Tree: No changes')
      break
    }

    case 'not_initialized': {
      lines.push('Context Tree: Not initialized — use `/init` command to initialize')
      break
    }

    default: {
      lines.push('Context Tree: Unable to check status')
    }
  }

  return lines.join('\n')
}
