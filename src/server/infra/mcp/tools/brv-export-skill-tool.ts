import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js'

import {z} from 'zod'

import {SkillConnector} from '../../../infra/connectors/skill/skill-connector.js'
import {SkillContentLoader} from '../../../infra/connectors/skill/skill-content-loader.js'
import {SkillExportService} from '../../../infra/connectors/skill/skill-export-service.js'
import {SkillKnowledgeBuilder} from '../../../infra/connectors/skill/skill-knowledge-builder.js'
import {ExperienceStore} from '../../../infra/context-tree/experience-store.js'
import {FsFileService} from '../../../infra/file/fs-file-service.js'
import {detectMcpMode} from '../mcp-mode-detector.js'
import {resolveClientCwd} from './resolve-client-cwd.js'

export const BrvExportSkillInputSchema = z.object({
  cwd: z
    .string()
    .optional()
    .describe(
      'Working directory of the project (absolute path). ' +
        'Required when the MCP server runs in global mode (e.g., Windsurf). ' +
        'Optional in project mode — defaults to the project directory.',
    ),
})

/**
 * Registers the brv-export-skill tool with the MCP server.
 *
 * This tool allows coding agents to export accumulated project knowledge
 * and optionally sync it into installed skill connector directories.
 *
 * Always returns the rendered knowledge text.  If installed skill targets
 * exist, also writes the managed block into their SKILL.md files.
 *
 * Does NOT require the daemon transport — reads directly from the filesystem.
 */
export function registerBrvExportSkillTool(
  server: McpServer,
  getWorkingDirectory: () => string | undefined,
): void {
  server.registerTool(
    'brv-export-skill',
    {
      description:
        'Export accumulated project knowledge from the ByteRover context tree. ' +
        'Returns rendered knowledge text and syncs into installed agent skill files.',
      inputSchema: BrvExportSkillInputSchema,
      title: 'ByteRover Export Skill',
    },
    async ({cwd}: {cwd?: string}) => {
      // 1. Resolve cwd — same validation as brv-curate/brv-query
      const cwdResult = resolveClientCwd(cwd, getWorkingDirectory)
      if (!cwdResult.success) {
        return {
          content: [{text: cwdResult.error, type: 'text' as const}],
          isError: true,
        }
      }

      // 2. Always walk up from the resolved cwd to find the real project root
      //    (.brv/config.json). This is necessary in both project and global mode
      //    because an explicit cwd parameter may point to a subdirectory.
      const modeResult = detectMcpMode(cwdResult.clientCwd)
      if (!modeResult.projectRoot) {
        return {
          content: [
            {
              text: 'Error: No ByteRover project found. Could not locate .brv/config.json by walking up from the provided cwd.',
              type: 'text' as const,
            },
          ],
          isError: true,
        }
      }

      const {projectRoot} = modeResult

      try {
        // 3. Construct services from resolved project root
        const fileService = new FsFileService()
        const skillContentLoader = new SkillContentLoader(fileService)
        const staticTemplate = await skillContentLoader.loadSkillFile('SKILL.md')
        const store = new ExperienceStore(projectRoot)
        const builder = new SkillKnowledgeBuilder(store)
        const skillConnector = new SkillConnector({fileService, projectRoot})
        const exportService = new SkillExportService({
          builder,
          fileService,
          skillConnector,
          staticTemplate,
        })

        // 4. Build knowledge block
        const block = await builder.build()

        // 5. Always sync — even when block is empty (cleanup stale markers)
        const result = await exportService.syncInstalledTargets(block)

        // 6. Compose response
        const parts: string[] = []

        if (block.length > 0) {
          parts.push(block)
        } else {
          parts.push('No project knowledge accumulated yet. Run `brv curate` to start.')
        }

        const totalTargets = result.updated.length + result.failed.length
        if (totalTargets === 0) {
          // No installed targets discovered at all
          parts.push('\nNo skill connectors installed. Use /connectors to set up.')
        } else {
          if (result.updated.length > 0) {
            const targets = result.updated.map((t) => `${t.agent} (${t.scope})`).join(', ')
            parts.push(`\nSynced to ${result.updated.length} target(s): ${targets}`)
          }

          if (result.failed.length > 0) {
            const failures = result.failed.map((f) => `${f.agent} (${f.scope}): ${f.error}`).join(', ')
            parts.push(`\nFailed ${result.failed.length} target(s): ${failures}`)
          }
        }

        return {
          content: [{text: parts.join('\n'), type: 'text' as const}],
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
