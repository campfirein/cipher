import type {ITransportClient} from '@campfirein/brv-transport-client'
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js'

import {waitForConnectedClient} from '@campfirein/brv-transport-client'
import {randomUUID} from 'node:crypto'
import {z} from 'zod'

import {TransportTaskEventNames} from '../../../core/domain/transport/schemas.js'
import {appendDriftFooter} from './drift-footer.js'
import {associateProjectWithRetry, type McpStartupProjectContext, resolveMcpTaskContext} from './mcp-project-context.js'
import {resolveClientCwd} from './resolve-client-cwd.js'
import {cwdField} from './shared-schema.js'
import {waitForTaskResult} from './task-result-waiter.js'

export const BrvQueryInputSchema = z.object({
  cwd: cwdField,
  query: z.string().describe('Natural language question about the codebase or project'),
})

/**
 * Registers the brv-query tool with the MCP server.
 *
 * This tool allows coding agents to query the ByteRover context tree
 * for patterns, decisions, implementation details, or any stored knowledge.
 */
export function registerBrvQueryTool(
  server: McpServer,
  getClient: () => ITransportClient | undefined,
  getWorkingDirectory: () => string | undefined,
  getStartupProjectContext: () => McpStartupProjectContext | undefined,
  clientVersion: string,
): void {
  server.registerTool(
    'brv-query',
    {
      description: 'Query the ByteRover context tree for patterns, decisions, or implementation details.',
      inputSchema: BrvQueryInputSchema,
      title: 'ByteRover Query',
    },
    async ({cwd, query}: {cwd?: string; query: string}) => {
      // Resolve clientCwd: explicit cwd param > server working directory
      const cwdResult = resolveClientCwd(cwd, getWorkingDirectory)
      if (!cwdResult.success) {
        return {
          content: [{text: cwdResult.error, type: 'text' as const}],
          isError: true,
        }
      }

      // Wait for a connected client (MCP's attemptReconnect() replaces client in background)
      const client = await waitForConnectedClient(getClient)
      if (!client) {
        return {
          content: [
            {
              text: 'Error: Not connected to the daemon. Connection timed out. Ensure "brv" is running.',
              type: 'text' as const,
            },
          ],
          isError: true,
        }
      }

      try {
        const taskContext = resolveMcpTaskContext(cwdResult.clientCwd, getStartupProjectContext())
        if (!getWorkingDirectory()) {
          await associateProjectWithRetry(client, taskContext.projectRoot)
        }

        const taskId = randomUUID()

        // Register event listeners BEFORE sending task:create to avoid race conditions.
        // If the task completes before listeners are set up, the task:completed event is missed.
        const resultPromise = waitForTaskResult(client, taskId)

        // Create task via transport (same pattern as brv query command)
        await client.requestWithAck(TransportTaskEventNames.CREATE, {
          clientCwd: cwdResult.clientCwd,
          content: query,
          projectPath: taskContext.projectRoot,
          taskId,
          type: 'query',
          worktreeRoot: taskContext.worktreeRoot,
        })

        // Wait for the already-listening result promise
        const result = await resultPromise

        return {
          content: [{text: appendDriftFooter(result, clientVersion, client.getDaemonVersion?.()), type: 'text' as const}],
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return {
          content: [{text: `Error: ${message}`, type: 'text' as const}],
          isError: true,
        }
      }
    },
  )
}
