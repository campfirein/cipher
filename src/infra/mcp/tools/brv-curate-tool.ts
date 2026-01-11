import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import { randomUUID } from 'node:crypto'
import { z } from 'zod'

import type { ITransportClient } from '../../../core/interfaces/transport/index.js'

import { waitForTaskResult } from './task-result-waiter.js'

export const BrvCurateInputSchema = z.object({
  context: z.string().describe('Knowledge to store: patterns, decisions, errors, or insights about the codebase'),
  files: z
    .array(z.string())
    .max(5)
    .optional()
    .describe('Optional file paths with critical context to include (max 5 files)'),
})

/**
 * Registers the brv-curate tool with the MCP server.
 *
 * This tool allows coding agents to store context to the ByteRover context tree.
 * Use it to save patterns, architectural decisions, error solutions, or insights.
 */
export function registerBrvCurateTool(
  server: McpServer,
  getClient: () => ITransportClient | undefined,
  getWorkingDirectory: () => string,
): void {
  server.registerTool(
    'brv-curate',
    {
      description: 'Store context to the ByteRover context tree. Save patterns, decisions, or insights.',
      inputSchema: BrvCurateInputSchema,
      title: 'ByteRover Curate',
    },
    async ({context, files}: {context: string; files?: string[]}) => {
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
          content: [{text: `Error: Socket not connected. Current state: ${state}. Ensure "brv" is running.`, type: 'text' as const}],
          isError: true,
        }
      }

      try {
        const taskId = randomUUID()

        // Create task via transport (same pattern as brv curate command)
        await client.request('task:create', {
          clientCwd: getWorkingDirectory(),
          content: context,
          taskId,
          type: 'curate',
          ...(files?.length ? {files} : {}),
        })

        // Wait for task completion and return result
        const result = await waitForTaskResult(client, taskId)

        return {
          content: [{ text: result || 'Context curated successfully.', type: 'text' as const }],
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return {
          content: [{ text: `Error: ${message}`, type: 'text' as const }],
          isError: true,
        }
      }
    },
  )
}
