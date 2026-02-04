import type {ITransportClient} from '@campfirein/brv-transport-client'
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js'

import {randomUUID} from 'node:crypto'
import {z} from 'zod'

import {waitForTaskResult} from './task-result-waiter.js'

export const BrvQueryInputSchema = z.object({
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
  getWorkingDirectory: () => string,
): void {
  server.registerTool(
    'brv-query',
    {
      description: 'Query the ByteRover context tree for patterns, decisions, or implementation details.',
      inputSchema: BrvQueryInputSchema,
      title: 'ByteRover Query',
    },
    async ({query}: {query: string}) => {
      const client = getClient()

      if (!client) {
        return {
          content: [{text: 'Error: Not connected to ByteRover instance. Run "brv" first.', type: 'text' as const}],
          isError: true,
        }
      }

      // Check connection state before making request
      const state = client.getState()

      if (state !== 'connected') {
        return {
          content: [
            {
              text: `Error: Socket not connected. Current state: ${state}. Ensure "brv" is running.`,
              type: 'text' as const,
            },
          ],
          isError: true,
        }
      }

      try {
        const taskId = randomUUID()

        // Create task via transport (same pattern as brv query command)
        await client.requestWithAck('task:create', {
          clientCwd: getWorkingDirectory(),
          content: query,
          taskId,
          type: 'query',
        })

        // Wait for task completion and return result
        const result = await waitForTaskResult(client, taskId)

        return {
          content: [{text: result, type: 'text' as const}],
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
