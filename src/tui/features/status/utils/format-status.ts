/**
 * Pure formatting function for CLI status output.
 */

import chalk from 'chalk'

import type {StatusDTO} from '../../../../shared/transport/types/dto.js'

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

  switch (status.contextTreeStatus) {
    case 'git_vc': {
      lines.push('Context Tree: Byterover version control (use /vc commands)')
      break
    }

    case 'has_changes': {
      if (status.contextTreeChanges && status.contextTreeRelativeDir) {
        const {added, deleted, modified} = status.contextTreeChanges
        const formatPath = (file: string) => `${status.contextTreeRelativeDir}/${file}`

        const allChanges: {color: (s: string) => string; path: string; status: string}[] = [
          ...modified.map((f) => ({color: chalk.red, path: f, status: 'modified:'})),
          ...added.map((f) => ({color: chalk.red, path: f, status: 'new file:'})),
          ...deleted.map((f) => ({color: chalk.red, path: f, status: 'deleted:'})),
        ].sort((a, b) => a.path.localeCompare(b.path))

        lines.push('Context Tree Changes:')
        for (const change of allChanges) {
          lines.push(`   ${change.color(`${change.status.padEnd(10)} ${formatPath(change.path)}`)}`)
        }
      }

      break
    }

    case 'no_changes': {
      lines.push('Context Tree: No changes')
      break
    }

    case 'not_initialized': {
      lines.push('Context Tree: Not initialized')
      break
    }

    default: {
      lines.push('Context Tree: Unable to check status')
    }
  }

  // Knowledge workspaces
  if (status.workspaces && status.workspaces.length > 0) {
    lines.push(`Workspaces: ${status.workspaces.length} linked`)
    for (const ws of status.workspaces) {
      lines.push(`   ${ws}`)
    }
  }

  // Hub dependencies
  if (status.dependencies && Object.keys(status.dependencies).length > 0) {
    const deps = Object.entries(status.dependencies)
    lines.push(`Dependencies: ${deps.length} installed`)
    for (const [name, version] of deps) {
      lines.push(`   ${name}@${version}`)
    }
  }

  return lines.join('\n')
}
