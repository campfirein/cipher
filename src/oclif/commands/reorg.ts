import {Command, Flags} from '@oclif/core'
import {join} from 'node:path'

import type {ReorgExecutionSummary} from '../../server/core/interfaces/executor/i-reorg-executor.js'

import {CONTEXT_TREE_DIR} from '../../server/constants.js'
import {ReorgExecutor} from '../../server/infra/executor/reorg-executor.js'
import {FileHarnessTreeStore} from '../../server/infra/harness/file-harness-tree-store.js'
import {HarnessEngine} from '../../server/infra/harness/harness-engine.js'
import {ReorgHarnessService} from '../../server/infra/harness/reorg/reorg-harness-service.js'
import {createLocalAgent} from '../../server/infra/process/local-agent-bootstrap.js'
import {writeJsonResponse} from '../lib/json-response.js'

export default class Reorg extends Command {
  public static description = [
    'Reorganize the context tree (merge duplicates, move misclassified entries).',
    '',
    'Execution is all-or-nothing: if any operation fails, all changes are rolled',
    'back to the pre-reorg state. Use --dry-run to preview candidates first.',
  ].join('\n')
  public static flags = {
    directory: Flags.string({char: 'd', description: 'Override working directory'}),
    'dry-run': Flags.boolean({char: 'n', description: 'Detect candidates without executing'}),
    format: Flags.string({char: 'f', default: 'text', description: 'Output format', options: ['text', 'json']}),
  }
  public static hidden = true

  public async run(): Promise<void> {
    const {flags} = await this.parse(Reorg)
    const isJson = flags.format === 'json'
    const dryRun = flags['dry-run'] ?? false
    const projectPath = flags.directory ?? process.cwd()

    let cleanup: (() => Promise<void>) | undefined

    try {
      // 1. Create local agent
      const {agent, cleanup: agentCleanup, storagePath} = await createLocalAgent(projectPath)
      cleanup = agentCleanup

      // 2. Resolve context tree directory
      const contextTreeDir = join(projectPath, '.brv', CONTEXT_TREE_DIR)

      // 3. Create harness infrastructure
      const treeStore = new FileHarnessTreeStore({
        getBaseDir: () => storagePath,
      })
      const engine = new HarnessEngine({
        config: {domain: 'reorg'},
        treeStore,
      })
      const harnessService = new ReorgHarnessService(engine, treeStore)

      // 4. Wire content generator from agent session into harness service
      const {sessionId} = agent
      if (sessionId) {
        const session = agent.getSession(sessionId)
        if (session) {
          harnessService.setContentGenerator(session.getLLMService().getContentGenerator())
        }
      }

      // 5. Create executor
      const executor = new ReorgExecutor({harnessService})

      // 6. Execute
      const summary = await executor.detectAndExecute({
        agent,
        contextTreeDir,
        dryRun,
        projectBaseDir: projectPath,
      })

      // 7. Format and print results
      if (isJson) {
        writeJsonResponse({
          command: 'reorg',
          data: summary,
          success: true,
        })
      } else {
        this.formatTextOutput(summary, dryRun)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (isJson) {
        writeJsonResponse({
          command: 'reorg',
          data: {error: message},
          success: false,
        })
      } else {
        this.error(message)
      }
    } finally {
      if (cleanup) {
        await cleanup()
      }
    }
  }

  private formatTextOutput(summary: ReorgExecutionSummary, dryRun: boolean): void {
    if (dryRun) {
      this.log(`[dry-run] Detected ${summary.candidatesDetected} candidate(s)`)
      if (summary.candidatesDetected === 0) {
        this.log('No reorganisation candidates found.')
      }

      return
    }

    if (summary.candidatesDetected === 0) {
      this.log('No reorganisation candidates found.')

      return
    }

    this.log(`Detected: ${summary.candidatesDetected}`)
    this.log(`Executed: ${summary.candidatesExecuted}`)
    this.log(`Skipped:  ${summary.candidatesSkipped}`)

    for (const result of summary.results) {
      const status = result.success ? 'OK' : 'FAIL'
      const label = result.candidate.type === 'merge' ? 'merge' : 'move'
      const target = result.candidate.targetPath
      this.log(`  [${status}] ${label} -> ${target}${result.error ? ` (${result.error})` : ''}`)
    }
  }
}
