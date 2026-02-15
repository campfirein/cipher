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
      lines.push('Status: Session expired (login required)')
      break
    }

    case 'logged_in': {
      lines.push(`Status: Logged in as ${status.userEmail}`)
      break
    }

    case 'not_logged_in': {
      lines.push('Status: Not logged in')
      break
    }

    default: {
      lines.push('Status: Unable to check authentication status')
    }
  }

  lines.push(`Current Directory: ${status.currentDirectory}`)

  if (status.teamName && status.spaceName) {
    lines.push(`Project Status: Connected to ${status.teamName}/${status.spaceName}`)
  } else {
    lines.push('Project Status: Configuration file exists but is invalid')
  }

  switch (status.contextTreeStatus) {
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

  return lines.join('\n')
}
