import {expect} from 'chai'
import {execFileSync} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'

import type {ReasoningContentItem as SharedReasoningContentItem, ToolCallEvent as SharedToolCallEvent} from '../../../../../src/shared/transport/events/task-events.js'
// Re-import the same type names from the (now-re-exporting) defining files.
// If these files don't re-export, this import block fails to compile —
// that's the import-resolution check.
import type {ReasoningContentItem as TuiStoreReasoningContentItem, ToolCallEvent as TuiStoreToolCallEvent} from '../../../../../src/tui/features/tasks/stores/tasks-store.js'
import type {ReasoningContentItem as TuiMessagesReasoningContentItem} from '../../../../../src/tui/types/messages.js'
import type {ReasoningContentItem as WebuiReasoningContentItem, ToolCallEvent as WebuiToolCallEvent} from '../../../../../src/webui/features/tasks/types/stored-task.js'

import {TaskHistoryEntrySchema} from '../../../../../src/server/core/domain/entities/task-history-entry.js'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..', '..', '..')

function baseEntry() {
  return {
    content: 'do the thing',
    createdAt: 1_745_432_000_000,
    id: 'tsk-1',
    projectPath: '/p',
    schemaVersion: 1 as const,
    taskId: 'a',
    type: 'curate',
  }
}

describe('M2.01 — TaskHistoryEntry + consolidation', () => {
  describe('TaskHistoryEntry schema', () => {
    it('parses each status branch with required fields', () => {
      const created = TaskHistoryEntrySchema.safeParse({...baseEntry(), status: 'created'})
      expect(created.success, JSON.stringify(created)).to.equal(true)

      const started = TaskHistoryEntrySchema.safeParse({
        ...baseEntry(),
        startedAt: 1_745_432_001_000,
        status: 'started',
      })
      expect(started.success, JSON.stringify(started)).to.equal(true)

      const completed = TaskHistoryEntrySchema.safeParse({
        ...baseEntry(),
        completedAt: 1_745_432_002_000,
        result: 'done',
        startedAt: 1_745_432_001_000,
        status: 'completed',
      })
      expect(completed.success, JSON.stringify(completed)).to.equal(true)

      const errored = TaskHistoryEntrySchema.safeParse({
        ...baseEntry(),
        completedAt: 1_745_432_002_000,
        error: {message: 'boom', name: 'Error'},
        startedAt: 1_745_432_001_000,
        status: 'error',
      })
      expect(errored.success, JSON.stringify(errored)).to.equal(true)

      const cancelled = TaskHistoryEntrySchema.safeParse({
        ...baseEntry(),
        completedAt: 1_745_432_002_000,
        startedAt: 1_745_432_001_000,
        status: 'cancelled',
      })
      expect(cancelled.success, JSON.stringify(cancelled)).to.equal(true)
    })

    it('rejects completed without completedAt', () => {
      const result = TaskHistoryEntrySchema.safeParse({
        ...baseEntry(),
        result: 'done',
        startedAt: 1_745_432_001_000,
        status: 'completed',
      })
      expect(result.success).to.equal(false)
      if (!result.success) {
        const paths = result.error.issues.map((issue) => issue.path.join('.'))
        expect(paths).to.include('completedAt')
      }
    })

    it('rejects error without error payload', () => {
      const result = TaskHistoryEntrySchema.safeParse({
        ...baseEntry(),
        completedAt: 1_745_432_002_000,
        startedAt: 1_745_432_001_000,
        status: 'error',
      })
      expect(result.success).to.equal(false)
      if (!result.success) {
        const paths = result.error.issues.map((issue) => issue.path.join('.'))
        expect(paths).to.include('error')
      }
    })

    it('accepts provider + model on every branch', () => {
      const branches: Array<Record<string, unknown>> = [
        {status: 'created'},
        {startedAt: 1_745_432_001_000, status: 'started'},
        {completedAt: 1_745_432_002_000, result: 'done', status: 'completed'},
        {
          completedAt: 1_745_432_002_000,
          error: {message: 'boom', name: 'Error'},
          status: 'error',
        },
        {completedAt: 1_745_432_002_000, status: 'cancelled'},
      ]

      for (const branch of branches) {
        const result = TaskHistoryEntrySchema.safeParse({
          ...baseEntry(),
          ...branch,
          model: 'gpt-5-pro',
          provider: 'openai',
        })
        expect(result.success, JSON.stringify(result)).to.equal(true)
      }

      // ByteRover (internal — provider only, no model) — completed branch
      const byterover = TaskHistoryEntrySchema.safeParse({
        ...baseEntry(),
        completedAt: 1_745_432_002_000,
        provider: 'byterover',
        result: 'done',
        status: 'completed',
      })
      expect(byterover.success, JSON.stringify(byterover)).to.equal(true)
    })
  })

  describe('shared types consolidation', () => {
    // eslint-disable-next-line unicorn/consistent-function-scoping
    function countDefinitions(typeName: string): number {
      // Mirrors the ticket's verification step: `grep -rn "^export (interface|type) X" src/ | wc -l`
      // CLAUDE.md prefers `type` for DTO shapes, so accept both forms.
      // Use `--include` to scope the scan to ts/tsx so generated/binary files don't pollute counts.
      try {
        const output = execFileSync(
          'grep',
          [
            '-rEn',
            '--include=*.ts',
            '--include=*.tsx',
            `^export (interface|type) ${typeName}\\b`,
            join(repoRoot, 'src'),
          ],
          {encoding: 'utf8'},
        )
        return output.trim() === '' ? 0 : output.trim().split('\n').length
      } catch (error) {
        // grep exits 1 when no match — return 0 in that case.
        if ((error as {status?: number}).status === 1) return 0
        throw error
      }
    }

    it('ReasoningContentItem defined exactly once (in shared/)', () => {
      expect(countDefinitions('ReasoningContentItem')).to.equal(1)
      // And the one location is shared/
      const sharedFile = readFileSync(
        join(repoRoot, 'src/shared/transport/events/task-events.ts'),
        'utf8',
      )
      expect(/^export (interface|type) ReasoningContentItem\b/m.test(sharedFile)).to.equal(true)
    })

    it('ToolCallEvent defined exactly once (in shared/)', () => {
      expect(countDefinitions('ToolCallEvent')).to.equal(1)
      const sharedFile = readFileSync(
        join(repoRoot, 'src/shared/transport/events/task-events.ts'),
        'utf8',
      )
      expect(/^export (interface|type) ToolCallEvent\b/m.test(sharedFile)).to.equal(true)
    })

    it('webui + tui imports resolve from shared/', () => {
      // Compile-time check: the imports at the top of this file would fail if
      // the re-exports from stored-task / tasks-store / messages were missing.
      // Runtime check: structural identity — assigning across the re-export
      // boundary must compile, proving the types are nominally the same.
      const reasoning: SharedReasoningContentItem = {
        content: 'thinking',
        timestamp: 1,
      }
      const fromWebui: WebuiReasoningContentItem = reasoning
      const fromTuiStore: TuiStoreReasoningContentItem = reasoning
      const fromTuiMessages: TuiMessagesReasoningContentItem = reasoning

      const tool: SharedToolCallEvent = {
        args: {},
        sessionId: 's',
        status: 'completed',
        timestamp: 1,
        toolName: 't',
      }
      const fromWebuiTool: WebuiToolCallEvent = tool
      const fromTuiStoreTool: TuiStoreToolCallEvent = tool

      expect(fromWebui).to.equal(reasoning)
      expect(fromTuiStore).to.equal(reasoning)
      expect(fromTuiMessages).to.equal(reasoning)
      expect(fromWebuiTool).to.equal(tool)
      expect(fromTuiStoreTool).to.equal(tool)
    })
  })
})
