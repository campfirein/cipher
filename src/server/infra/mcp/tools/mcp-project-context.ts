import type {ITransportClient} from '@campfirein/brv-transport-client'

import {MCP_ASSOCIATE_PROJECT_MAX_ATTEMPTS, MCP_ASSOCIATE_PROJECT_TIMEOUT_MS} from '../../../constants.js'
import {TransportClientEventNames} from '../../../core/domain/transport/schemas.js'
import {type ProjectResolution, resolveProject} from '../../project/resolve-project.js'

export type McpStartupProjectContext = {
  projectRoot: string
  workspaceRoot: string
}

export type ResolvedMcpTaskContext = {
  projectRoot: string
  workspaceRoot: string
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
}

export async function associateProjectWithRetry(client: ITransportClient, projectPath: string): Promise<void> {
  let lastError: unknown

  /* eslint-disable no-await-in-loop -- intentional sequential retry loop */
  for (let attempt = 1; attempt <= MCP_ASSOCIATE_PROJECT_MAX_ATTEMPTS; attempt++) {
    try {
      await withTimeout(
        client.requestWithAck(TransportClientEventNames.ASSOCIATE_PROJECT, {projectPath}),
        MCP_ASSOCIATE_PROJECT_TIMEOUT_MS,
        `Timed out waiting for project association ack after ${MCP_ASSOCIATE_PROJECT_TIMEOUT_MS}ms`,
      )
      return
    } catch (error) {
      lastError = error
    }
  }
  /* eslint-enable no-await-in-loop */

  throw new Error(
    `Failed to associate MCP client with project "${projectPath}": ${describeError(lastError)}. ` +
      `Retry the tool call or run 'brv restart' if the daemon is unresponsive.`,
  )
}

export function resolveMcpTaskContext(
  clientCwd: string,
  startupProjectContext?: McpStartupProjectContext,
): ResolvedMcpTaskContext {
  const resolution = resolveProject({cwd: clientCwd})
  if (resolution) {
    return projectResolutionToTaskContext(resolution)
  }

  if (startupProjectContext && clientCwd === startupProjectContext.workspaceRoot) {
    return startupProjectContext
  }

  throw new Error(`No ByteRover project could be resolved from cwd "${clientCwd}".`)
}

function projectResolutionToTaskContext(resolution: ProjectResolution): ResolvedMcpTaskContext {
  return {
    projectRoot: resolution.projectRoot,
    workspaceRoot: resolution.workspaceRoot,
  }
}
