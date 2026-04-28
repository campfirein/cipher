/**
 * brv-record-answer MCP tool (Phase 5 Task 5.4).
 *
 * Closes the cache loop after agent-side synthesis. Agent calls this with
 * the same query+fingerprint it received from a prior `brv_search` /
 * `brv_gather` round-trip, plus the synthesized answer. Future equivalent
 * queries hit tier 0/1 via `brv_search` / `brv_query`.
 *
 * Optional — agents that skip this lose cache benefit on equivalent
 * future queries but stay correct (cache miss → full pipeline still works).
 */

import type {ITransportClient} from '@campfirein/brv-transport-client'
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js'

import {waitForConnectedClient} from '@campfirein/brv-transport-client'
import {randomUUID} from 'node:crypto'
import {z} from 'zod'

import {encodeRecordAnswerContent} from '../../../../shared/transport/record-answer-content.js'
import {TransportTaskEventNames} from '../../../core/domain/transport/schemas.js'
import {associateProjectWithRetry, type McpStartupProjectContext, resolveMcpTaskContext} from './mcp-project-context.js'
import {resolveClientCwd} from './resolve-client-cwd.js'
import {cwdField} from './shared-schema.js'
import {waitForTaskResult} from './task-result-waiter.js'

export const BrvRecordAnswerInputSchema = z.object({
  answer: z.string().min(1).describe('Synthesized answer to cache for future tier-0/1 hits'),
  cwd: cwdField,
  fingerprint: z.string().min(1).describe('Cache key fingerprint from prior brv_search / brv_gather call'),
  query: z.string().min(1).describe('The query the answer responds to'),
})

export function registerBrvRecordAnswerTool(
  server: McpServer,
  getClient: () => ITransportClient | undefined,
  getWorkingDirectory: () => string | undefined,
  getStartupProjectContext: () => McpStartupProjectContext | undefined,
): void {
  server.registerTool(
    'brv-record-answer',
    {
      description:
        'Cache an agent-synthesized answer so future equivalent queries hit tier 0/1. ' +
        'Optional — skipping it loses cache benefit but stays correct. Use after synthesizing ' +
        'from a brv-gather bundle.',
      inputSchema: BrvRecordAnswerInputSchema,
      title: 'ByteRover Record Answer',
    },
    async (input: {answer: string; cwd?: string; fingerprint: string; query: string}) => {
      const cwdResult = resolveClientCwd(input.cwd, getWorkingDirectory)
      if (!cwdResult.success) {
        return {content: [{text: cwdResult.error, type: 'text' as const}], isError: true}
      }

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
        const resultPromise = waitForTaskResult(client, taskId)

        await client.requestWithAck(TransportTaskEventNames.CREATE, {
          clientCwd: cwdResult.clientCwd,
          content: encodeRecordAnswerContent({
            answer: input.answer,
            fingerprint: input.fingerprint,
            query: input.query,
          }),
          projectPath: taskContext.projectRoot,
          taskId,
          type: 'record-answer',
          worktreeRoot: taskContext.worktreeRoot,
        })

        const result = await resultPromise

        return {content: [{text: result, type: 'text' as const}]}
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return {content: [{text: `Error: ${message}`, type: 'text' as const}], isError: true}
      }
    },
  )
}
