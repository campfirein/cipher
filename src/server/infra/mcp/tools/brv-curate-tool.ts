import type {ITransportClient} from '@campfirein/brv-transport-client'
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js'

import {waitForConnectedClient} from '@campfirein/brv-transport-client'
import {randomUUID} from 'node:crypto'
import {z} from 'zod'

import type {CurateHtmlDirectResult} from '../../../core/interfaces/executor/i-curate-executor.js'
import type {HtmlWriteError} from '../../render/writer/html-writer.js'

import {encodeCurateHtmlContent} from '../../../../shared/transport/curate-html-content.js'
import {CURATE_SCHEMA_PROMPT} from '../../../core/domain/render/curate-prompt-builder.js'
import {TransportTaskEventNames} from '../../../core/domain/transport/schemas.js'
import {appendDriftFooter} from './drift-footer.js'
import {associateProjectWithRetry, type McpStartupProjectContext, resolveMcpTaskContext} from './mcp-project-context.js'
import {resolveClientCwd} from './resolve-client-cwd.js'
import {cwdField} from './shared-schema.js'
import {waitForTaskResult} from './task-result-waiter.js'

/**
 * Self-contained authoring guide embedded in the MCP tool description.
 *
 * MCP and the bundled SKILL.md are disjoint installation surfaces — a
 * user who installs the connector with `--type mcp` typically never
 * sees SKILL.md. The description has to carry enough of the bv-topic
 * vocabulary that a calling agent can author a valid topic without
 * external references.
 *
 * The vocabulary slice is derived from `ELEMENT_REGISTRY` (via the
 * existing `CURATE_SCHEMA_PROMPT` the CLI's curate prompt builder
 * uses) so MCP and CLI never drift on what elements are valid.
 */
const TOOL_DESCRIPTION = [
  'Store knowledge in the ByteRover context tree by writing a <bv-topic> HTML document.',
  '',
  'Runs deterministic validation + write — no LLM provider required. The calling agent authors',
  'the HTML in its own context; ByteRover validates the structure and writes the file.',
  '',
  '# Output contract',
  '- Bare HTML only — first character must be `<`, last characters must be `</bv-topic>`.',
  '- No markdown fences, no prose preamble, no trailing commentary.',
  '- Exactly one <bv-topic> root element per call.',
  '- All attribute names lowercase; all attribute values double-quoted.',
  '- Do not invent elements or attributes outside the vocabulary below.',
  '- Do not emit `importance`, `maturity`, `recency`, `createdat`, or `updatedat` on <bv-topic> — those are system-managed.',
  '',
  '# Path format',
  '- The `path` attribute on <bv-topic> is `<domain>/<topic>` or `<domain>/<topic>/<subtopic>`, snake_case segments.',
  '- Pick descriptive domain names (1-3 words). Reuse existing domains where they fit; avoid generic names like `misc`, `general`.',
  '',
  '# Element vocabulary (closed)',
  '',
  CURATE_SCHEMA_PROMPT,
  '',
  '# Minimal example',
  '<bv-topic path="security/auth" title="JWT authentication">',
  '  <bv-decision id="d-rs256" severity="must">Use RS256 over HS256 for JWT signing — verifiers only need the public key.</bv-decision>',
  '  <bv-rule severity="must">Access tokens expire after 24 hours.</bv-rule>',
  '</bv-topic>',
  '',
  '# Overwrite behavior',
  'When a topic already exists at the resolved path, the tool refuses to clobber by default and returns',
  'a structured `path-exists` error with the existing content inlined so you can merge. Pass',
  '`confirmOverwrite: true` to replace the existing topic entirely.',
].join('\n')

// Strict so the legacy `{context, files, folder}` shape (or any typo'd field)
// fails fast at the MCP boundary instead of being silently dropped — the
// breaking-change contract from the PR is that callers see an error pointing
// at the new schema, not a successful no-op.
export const BrvCurateInputSchema = z
  .object({
    confirmOverwrite: z
      .boolean()
      .optional()
      .describe(
        'Set true to replace an existing topic at the resolved path. Default false — the daemon refuses to clobber and returns a structured `path-exists` error with the existing content for merging.',
      ),
    cwd: cwdField,
    html: z
      .string()
      .min(1)
      .describe(
        'Complete <bv-topic> HTML document. Must include a `path` attribute on the root <bv-topic>. See the tool description for the closed element vocabulary and output contract.',
      ),
  })
  .strict()

/**
 * Registers the brv-curate tool with the MCP server.
 *
 * Post-M3: routes through the daemon's `curate-html-direct` task type,
 * which validates the HTML and writes the topic via `writeHtmlTopic` —
 * no LLM dispatch, no provider required.
 *
 * Wire shape: same end-state as the post-ENG-2815 oclif `brv curate`
 * (which uses session protocol + the same writer). MCP collapses the
 * multi-turn session into a single tool call because MCP's natural
 * shape is one request → one response; calling agents retry with
 * corrected HTML by calling the tool again, not via daemon-side
 * session state.
 *
 * Self-containment: the tool description embeds the bv-topic vocabulary
 * (derived from `ELEMENT_REGISTRY` via `CURATE_SCHEMA_PROMPT`) and a
 * worked example — MCP clients without SKILL.md still have everything
 * they need.
 */
export function registerBrvCurateTool(
  server: McpServer,
  getClient: () => ITransportClient | undefined,
  getWorkingDirectory: () => string | undefined,
  getStartupProjectContext: () => McpStartupProjectContext | undefined,
  clientVersion: string,
): void {
  server.registerTool(
    'brv-curate',
    {
      description: TOOL_DESCRIPTION,
      inputSchema: BrvCurateInputSchema,
      title: 'ByteRover Curate',
    },
    async ({confirmOverwrite, cwd, html}: {confirmOverwrite?: boolean; cwd?: string; html: string}) => {
      const cwdResult = resolveClientCwd(cwd, getWorkingDirectory)
      if (!cwdResult.success) {
        return {
          content: [{text: cwdResult.error, type: 'text' as const}],
          isError: true,
        }
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
          content: encodeCurateHtmlContent({confirmOverwrite, html}),
          projectPath: taskContext.projectRoot,
          taskId,
          type: 'curate-html-direct',
          worktreeRoot: taskContext.worktreeRoot,
        })

        const rawResult = await resultPromise

        let envelope: CurateHtmlDirectResult
        try {
          envelope = JSON.parse(rawResult) as CurateHtmlDirectResult
        } catch {
          return {
            content: [
              {
                text: 'Error: ByteRover daemon returned a malformed curate result. Rebuild byterover-cli to align the MCP and daemon versions.',
                type: 'text' as const,
              },
            ],
            isError: true,
          }
        }

        const text = renderEnvelope(envelope)
        return {
          content: [{text: appendDriftFooter(text, clientVersion, client.getDaemonVersion?.()), type: 'text' as const}],
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

/**
 * Render the `CurateHtmlDirectResult` envelope as a text block for the
 * calling agent.
 *
 * - `status: 'ok'`: a single confirmation line (`✓ Wrote` / `✓ Replaced`).
 * - `status: 'validation-failed'`: one `✗ <kind>: <message>` line per
 *   error. `path-exists` inlines the existing content as a fenced ```html
 *   block. The vocabulary slice is appended at the bottom so the agent
 *   has the schema in-context without needing to re-list tools.
 */
function renderEnvelope(envelope: CurateHtmlDirectResult): string {
  if (envelope.status === 'ok') {
    const action = envelope.overwrote ? 'Replaced' : 'Wrote'
    return `✓ ${action} topic to ${envelope.filePath}`
  }

  const lines = envelope.errors.map((err) => renderError(err))
  return [
    'Curate validation failed. Fix the errors below and call the tool again with corrected HTML.',
    '',
    ...lines,
    '',
    '# Element vocabulary (for reference)',
    '',
    CURATE_SCHEMA_PROMPT,
  ].join('\n')
}

function renderError(err: HtmlWriteError): string {
  switch (err.kind) {
    case 'attribute-validation': {
      return `✗ attribute-validation: <${err.tag}> attribute "${err.field}" — ${err.message}`
    }

    case 'missing-bv-topic': {
      return `✗ missing-bv-topic: ${err.message}`
    }

    case 'missing-path-attribute': {
      return `✗ missing-path-attribute: ${err.message}`
    }

    case 'multiple-bv-topic': {
      return `✗ multiple-bv-topic: ${err.message}`
    }

    case 'path-exists': {
      const existing =
        err.existingContent === undefined
          ? '(existing content could not be read — investigate the file or pass `confirmOverwrite: true` to clobber)'
          : `Existing content:\n\`\`\`html\n${err.existingContent}\n\`\`\``
      return `✗ path-exists: ${err.message}\n\n${existing}`
    }

    case 'unknown-bv-element': {
      return `✗ unknown-bv-element: <${err.tag}> is not in the registry — remove or replace with a registered element.`
    }

    case 'unsafe-path': {
      return `✗ unsafe-path: ${err.message}`
    }

    default: {
      // exhaustiveness check
      const _exhaustive: never = err
      return `✗ unknown-error: ${JSON.stringify(_exhaustive)}`
    }
  }
}
