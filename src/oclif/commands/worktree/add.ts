import {Args, Command} from '@oclif/core'
import {writeFileSync} from 'node:fs'
import {join, resolve, sep} from 'node:path'

import {WORKTREE_LINK_FILE} from '../../../server/constants.js'
import {
  findNearestWorktreeLink,
  hasBrvConfig,
  isDescendantOf,
  isGitRoot,
} from '../../../server/infra/project/resolve-project.js'
import {resolvePath} from '../../../server/utils/path-utils.js'

/**
 * Walk up from startDir looking for the nearest directory with .brv/config.json.
 * Stops at the git root boundary (same as the canonical resolver) to avoid
 * cross-repo auto-discovery in nested repo/worktree setups.
 */
function findNearestProjectRoot(startDir: string): string | undefined {
  let current = startDir
  const root = resolve('/')

  while (current !== root) {
    if (hasBrvConfig(current)) {
      return current
    }

    if (isGitRoot(current)) {
      break
    }

    const parent = resolve(current, '..')
    if (parent === current) break
    current = parent
  }

  return undefined
}

export default class WorktreeAdd extends Command {
  static args = {
    projectRoot: Args.string({
      description: 'Path to the project root containing .brv/ (auto-detected if omitted)',
      required: false,
    }),
  }
  static description = 'Link current directory to a ByteRover project (.brv-worktree.json)'
  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> /path/to/monorepo',
  ]

  async run(): Promise<void> {
    const {args} = await this.parse(WorktreeAdd)
    const cwd = resolvePath(process.cwd())

    // Guard: cwd already has .brv/config.json — linking would be shadowed
    if (hasBrvConfig(cwd)) {
      this.error(
        'Current directory already has .brv/config.json (direct project). ' +
        'Linking here would be shadowed by the existing project. ' +
        'Run from a subdirectory instead.',
        {exit: 1},
      )
    }

    // Resolve target project root
    let targetRoot: string
    if (args.projectRoot) {
      targetRoot = resolvePath(resolve(args.projectRoot))
    } else {
      // Auto-detect: walk up from cwd looking for nearest .brv/config.json
      const detected = findNearestProjectRoot(cwd)
      if (!detected) {
        this.error(
          'No project root found. Provide a path: brv worktree add /path/to/project',
          {exit: 1},
        )
      }

      targetRoot = detected
    }

    // Validate: target has .brv/config.json
    if (!hasBrvConfig(targetRoot)) {
      this.error(
        `Target "${targetRoot}" does not have .brv/config.json. Run 'brv' there first to initialize.`,
        {exit: 1},
      )
    }

    // Validate: cwd is a descendant of the target
    if (!isDescendantOf(cwd, targetRoot)) {
      this.error(
        `Current directory "${cwd}" is not within "${targetRoot}". ` +
        'Workspace must be a subdirectory of the project root.',
        {exit: 1},
      )
    }

    // Validate: cwd is not the same as target (no self-link)
    if (cwd === targetRoot) {
      this.error(
        'Current directory is already the project root. No link needed.',
        {exit: 1},
      )
    }

    // Idempotent: check if already linked to the same target
    const existingLink = findNearestWorktreeLink(cwd)
    if (existingLink) {
      const linkDir = resolve(existingLink, '..')
      if (linkDir === cwd) {
        // Link file is in cwd — check if it points to the same target
        try {
          const {readFileSync} = await import('node:fs')
          const content = JSON.parse(readFileSync(existingLink, 'utf8'))
          const normalizedExisting = content.projectRoot?.endsWith(sep)
            ? content.projectRoot.slice(0, -1)
            : content.projectRoot
          if (normalizedExisting === targetRoot) {
            this.log(`Already linked to ${targetRoot}`)

            return
          }
        } catch {
          // Existing link is malformed — overwrite it
        }
      } else {
        // Link file is in an ancestor — warn about potential conflict
        this.warn(`Existing workspace link found at ${existingLink}. Creating a closer link in cwd.`)
      }
    }

    // Write the link file
    const linkFilePath = join(cwd, WORKTREE_LINK_FILE)
    const linkContent = JSON.stringify({projectRoot: targetRoot}, null, 2) + '\n'

    try {
      writeFileSync(linkFilePath, linkContent, 'utf8')
      this.log(`Linked workspace to ${targetRoot}`)
      this.log(`Created ${linkFilePath}`)
      this.log(`Run 'brv restart' to apply the new workspace configuration.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.error(`Failed to create workspace link: ${message}`, {exit: 1})
    }
  }
}
