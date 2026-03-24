import {existsSync, readFileSync, realpathSync, statSync, writeFileSync} from 'node:fs'
import {dirname, join, resolve, sep} from 'node:path'

import type {SlashCommand} from '../../../types/commands.js'

// eslint-disable-next-line no-restricted-imports -- link must re-resolve project after creating workspace link
import {resolveProject} from '../../../../server/infra/project/resolve-project.js'
import {ClientEvents} from '../../../../shared/transport/events/client-events.js'
import {useTransportStore} from '../../../stores/transport-store.js'

const BRV_DIR = '.brv'
const PROJECT_CONFIG_FILE = 'config.json'
const WORKSPACE_LINK_FILE = '.brv-workspace.json'

function hasBrvConfig(dir: string): boolean {
  return existsSync(join(dir, BRV_DIR, PROJECT_CONFIG_FILE))
}

function isGitRoot(dir: string): boolean {
  const gitPath = join(dir, '.git')
  try {
    const stat = statSync(gitPath)
    return stat.isDirectory() || stat.isFile()
  } catch {
    return false
  }
}

function isDescendantOf(descendant: string, ancestor: string): boolean {
  const normalizedAncestor = ancestor.endsWith(sep) ? ancestor : ancestor + sep
  return descendant === ancestor || descendant.startsWith(normalizedAncestor)
}

/**
 * Walk up from startDir looking for nearest .brv/config.json.
 * Stops at git root boundary to avoid cross-repo auto-discovery.
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

    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }

  return undefined
}

export const linkCommand: SlashCommand = {
  action(_context, args) {
    const cwd = resolve(process.cwd())

    // Guard: cwd already has .brv/config.json
    if (hasBrvConfig(cwd)) {
      return {
        content: 'Current directory already has .brv/config.json (direct project). Linking here would be shadowed. Run from a subdirectory instead.',
        messageType: 'error' as const,
        type: 'message' as const,
      }
    }

    // Resolve target project root
    let targetRoot: string
    const argTrimmed = args?.trim()
    if (argTrimmed) {
      targetRoot = realpathSync(resolve(argTrimmed))
    } else {
      // Auto-detect: walk up from cwd
      const detected = findNearestProjectRoot(cwd)
      if (!detected) {
        return {
          content: 'No project root found. Provide a path: /link /path/to/project',
          messageType: 'error' as const,
          type: 'message' as const,
        }
      }

      targetRoot = detected
    }

    // Validate: target has .brv/config.json
    if (!hasBrvConfig(targetRoot)) {
      return {
        content: `Target "${targetRoot}" does not have .brv/config.json. Run 'brv' there first to initialize.`,
        messageType: 'error' as const,
        type: 'message' as const,
      }
    }

    // Validate: cwd is a descendant of target
    if (!isDescendantOf(cwd, targetRoot)) {
      return {
        content: `Current directory is not within "${targetRoot}". Workspace must be a subdirectory of the project root.`,
        messageType: 'error' as const,
        type: 'message' as const,
      }
    }

    // Validate: not self-linking
    if (cwd === targetRoot) {
      return {
        content: 'Current directory is already the project root. No link needed.',
        messageType: 'info' as const,
        type: 'message' as const,
      }
    }

    // Idempotent: check if already linked to the same target
    const existingLinkPath = join(cwd, WORKSPACE_LINK_FILE)
    if (existsSync(existingLinkPath)) {
      try {
        const content = JSON.parse(readFileSync(existingLinkPath, 'utf8'))
        const normalized = content.projectRoot?.endsWith(sep)
          ? content.projectRoot.slice(0, -1)
          : content.projectRoot
        if (normalized === targetRoot) {
          return {
            content: `Already linked to ${targetRoot}`,
            messageType: 'info' as const,
            type: 'message' as const,
          }
        }
      } catch {
        // Malformed — overwrite below
      }
    }

    // Write the link file
    try {
      const linkContent = JSON.stringify({projectRoot: targetRoot}, null, 2) + '\n'
      writeFileSync(existingLinkPath, linkContent, 'utf8')

      // Re-resolve so transport store and daemon pick up the new link
      let resolution: ReturnType<typeof resolveProject> = null
      try {
        resolution = resolveProject()
      } catch {
        // Fall back to using target as project root
      }

      const store = useTransportStore.getState()
      store.setProjectInfo(resolution?.projectRoot ?? targetRoot, resolution?.workspaceRoot ?? cwd)
      store.client
        ?.requestWithAck(ClientEvents.ASSOCIATE_PROJECT, {projectPath: resolution?.projectRoot ?? targetRoot})
        .catch(() => {
          // Best-effort: server may not be reachable
        })

      return {
        content: `Linked workspace to ${targetRoot}. Run /status to verify.`,
        messageType: 'info' as const,
        type: 'message' as const,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      return {
        content: `Failed to create workspace link: ${message}`,
        messageType: 'error' as const,
        type: 'message' as const,
      }
    }
  },
  args: [
    {
      description: 'Path to the project root containing .brv/ (auto-detected if omitted)',
      name: 'projectRoot',
      required: false,
    },
  ],
  description: 'Link current directory to a ByteRover project',
  name: 'link',
}
