/**
 * Pure formatting function for CLI status output.
 */

import chalk from 'chalk'

import type {ProjectLocationDTO, StatusDTO} from '../../../../shared/transport/types/dto.js'

export function formatLocationEntry(loc: ProjectLocationDTO): string[] {
  const label = loc.isCurrent ? '  ' + chalk.green('[current]') : loc.isActive ? '  ' + chalk.yellow('[active]') : ''
  const path = loc.isCurrent || loc.isActive ? chalk.bold(loc.projectPath) : loc.projectPath
  const lines: string[] = [`  ${path}${label}`]

  if (loc.isInitialized) {
    const domainLabel = loc.domainCount === 1 ? 'domain' : 'domains'
    const fileLabel = loc.fileCount === 1 ? 'file' : 'files'
    lines.push(
      chalk.dim(`  └─ .brv/context-tree/    ${loc.domainCount} ${domainLabel} · ${loc.fileCount} ${fileLabel}`),
    )
  } else {
    lines.push(chalk.dim('  └─ .brv/context-tree/    (not initialized)'))
  }

  return lines
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

  // Registered project locations
  lines.push('')
  if (status.locations.length > 0) {
    lines.push(
      `Registered Projects — ${status.locations.length} found`,
      chalk.dim('──────────────────────────────────────────'),
    )
    for (const loc of status.locations) {
      for (const line of formatLocationEntry(loc)) {
        lines.push(line)
      }

      lines.push('')
    }
  } else {
    lines.push('Registered Projects — none found')
  }

  return lines.join('\n')
}
