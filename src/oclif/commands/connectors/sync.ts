import {Command, Flags} from '@oclif/core'

import type {ConnectorSyncResponse} from '../../../shared/transport/events/connector-events.js'

import {detectMcpMode} from '../../../server/infra/mcp/mcp-mode-detector.js'
import {writeJsonResponse} from '../../lib/json-response.js'

const SKILL_EXPORT_DISABLED_MESSAGE = 'Skill export is disabled.'

export default class ConnectorsSync extends Command {
  static description = 'Skill export is disabled'
  static examples = [
    '<%= config.bin %> connectors sync',
    '<%= config.bin %> connectors sync --format json',
  ]
  static flags = {
    format: Flags.string({
      default: 'text',
      description: 'Output format (text or json)',
      options: ['text', 'json'],
    }),
  }

  /**
   * Resolve the project root via walk-up from cwd.
   * Returns undefined when no .brv/config.json is found (outside a project).
   * Protected for test overriding.
   */
  protected getProjectRoot(): string | undefined {
    return detectMcpMode(process.cwd()).projectRoot
  }

  /**
   * Skill export is disabled; the command is retained only to return a clear error.
   * Protected for test overriding.
   */
  protected async performSync(_projectRoot: string): Promise<ConnectorSyncResponse> {
    throw new Error(SKILL_EXPORT_DISABLED_MESSAGE)
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(ConnectorsSync)
    const format = flags.format as 'json' | 'text'

    // Strict project detection — walk up from cwd, error if no .brv/config.json found.
    // Never falls back to process.cwd() to prevent silently cleaning up global SKILL.md files.
    const projectRoot = this.getProjectRoot()
    if (!projectRoot) {
      const message = 'No ByteRover project found. Run this from a directory with .brv/config.json.'
      if (format === 'json') {
        writeJsonResponse({command: 'connectors sync', data: {error: message}, success: false})
      } else {
        this.error(message)
      }

      return
    }

    try {
      const response = await this.performSync(projectRoot)

      if (format === 'json') {
        writeJsonResponse({command: 'connectors sync', data: response, success: true})
        return
      }

      // Text output
      if (response.block.length === 0) {
        this.log('No project knowledge accumulated yet. Run `brv curate` to start.')
      }

      const totalTargets = response.updated.length + response.failed.length
      if (totalTargets === 0) {
        this.log('No skill connectors installed. Use `brv connectors install` to set up.')
        return
      }

      if (response.updated.length > 0) {
        this.log(`Synced to ${response.updated.length} target(s):`)
        for (const t of response.updated) {
          this.log(`  ${t.agent} (${t.scope}): ${t.path}`)
        }
      }

      if (response.failed.length > 0) {
        this.log(`Failed ${response.failed.length} target(s):`)
        for (const f of response.failed) {
          this.log(`  ${f.agent} (${f.scope}): ${f.error}`)
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to sync skill knowledge.'
      if (format === 'json') {
        writeJsonResponse({command: 'connectors sync', data: {error: message}, success: false})
      } else {
        this.error(message)
      }
    }
  }
}
