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

  lines.push(`Project: ${status.projectRoot ?? status.currentDirectory}`)

  if (status.workspaceRoot && status.workspaceRoot !== status.projectRoot) {
    lines.push(`Workspace: ${status.workspaceRoot} (linked)`)
  }

  if (status.resolverError) {
    lines.push(chalk.yellow(`⚠ ${status.resolverError}`))
  }

  if (status.shadowedLink) {
    lines.push(chalk.yellow('⚠ Shadowed .brv-workspace.json found — .brv/ takes priority'))
  }

  if (status.teamName && status.spaceName) {
    lines.push(`Space: ${status.teamName}/${status.spaceName}`)
  } else {
    lines.push('Space: Not connected')
  }

  // Knowledge links
  if (status.knowledgeLinksError) {
    lines.push(chalk.yellow(`⚠ ${status.knowledgeLinksError}`))
  } else if (status.knowledgeLinks && status.knowledgeLinks.length > 0) {
    lines.push('Knowledge Links:')
    for (const link of status.knowledgeLinks) {
      if (link.valid) {
        const sizeInfo = link.contextTreeSize === undefined ? '' : ` [${link.contextTreeSize} files]`
        lines.push(`   ${link.alias} → ${link.projectRoot} ${chalk.green('(valid)')}${sizeInfo}`)
      } else {
        lines.push(`   ${link.alias} → ${link.projectRoot} ${chalk.red(`[BROKEN - run brv unlink-knowledge ${link.alias}]`)}`)
      }
    }
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
