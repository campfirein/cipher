import chalk from 'chalk'

import type {ProjectLocationDTO} from '../../../../shared/transport/types/dto.js'

function formatLocationEntry(loc: ProjectLocationDTO): string[] {
  const label = loc.isCurrent ? '  ' + chalk.green('[current]') : loc.isActive ? '  ' + chalk.yellow('[active]') : ''
  const path = loc.isCurrent || loc.isActive ? chalk.bold(loc.projectPath) : loc.projectPath
  const lines: string[] = [`  ${path}${label}`]

  if (loc.isInitialized) {
    lines.push(chalk.dim('  └─ .brv/context-tree/'))
  } else {
    lines.push(chalk.dim('  └─ .brv/context-tree/    (not initialized)'))
  }

  return lines
}

export function formatLocations(locations: ProjectLocationDTO[]): string {
  const lines: string[] = []

  if (locations.length > 0) {
    lines.push(
      `Registered Projects — ${locations.length} found`,
      chalk.dim('──────────────────────────────────────────'),
    )
    for (const loc of locations) {
      lines.push(...formatLocationEntry(loc), '')
    }
  } else {
    lines.push('Registered Projects — none found')
  }

  return lines.join('\n')
}
