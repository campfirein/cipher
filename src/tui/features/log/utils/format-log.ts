import chalk from 'chalk'

import type {IVcLogResponse} from '../../../../shared/transport/events/vc-events.js'

export function formatRelativeDate(date: Date): string {
  const now = Date.now()
  const diffMs = now - date.getTime()
  const diffSec = Math.floor(diffMs / 1000)

  if (diffSec < 60) return `${diffSec} second${diffSec === 1 ? '' : 's'} ago`

  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`

  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour} hour${diffHour === 1 ? '' : 's'} ago`

  const diffDay = Math.floor(diffHour / 24)
  if (diffDay < 30) return `${diffDay} day${diffDay === 1 ? '' : 's'} ago`

  const diffMonth = Math.floor(diffDay / 30)
  if (diffMonth < 12) return `${diffMonth} month${diffMonth === 1 ? '' : 's'} ago`

  const diffYear = Math.floor(diffMonth / 12)
  return `${diffYear} year${diffYear === 1 ? '' : 's'} ago`
}

export function formatCommitLog(commits: IVcLogResponse['commits'], currentBranch?: string): string {
  if (commits.length === 0) return ''

  return commits
    .map((commit, index) => {
      const shortSha = chalk.yellow(commit.sha.slice(0, 7))
      const headMarker =
        index === 0
          ? currentBranch
            ? ` ${chalk.yellow.bold(`(HEAD -> ${currentBranch})`)}`
            : ` ${chalk.yellow.bold('(HEAD)')}`
          : ''
      const relativeDate = formatRelativeDate(new Date(commit.timestamp))

      return [
        `* ${shortSha}${headMarker} ${commit.message}`,
        `  Author: ${commit.author.name} <${commit.author.email}>`,
        `  ${relativeDate}`,
      ].join('\n')
    })
    .join('\n\n')
}
