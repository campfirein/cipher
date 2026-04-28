/**
 * Task History Entry — Level 2 schema (full per-task detail).
 *
 * Persisted shape used by `FileTaskHistoryStore` (M2.02+) to keep a
 * per-project journal of every task. Includes provider/model snapshot
 * (M1) plus accumulated llmservice details — response, reasoning,
 * tool calls — so the Web UI can re-render a complete task detail
 * after daemon restart.
 *
 * Discriminated union on `status`:
 * - `created`: just queued, agent has not picked up yet.
 * - `started`: agent acknowledged, `startedAt` set.
 * - `completed` | `error` | `cancelled`: terminal — `completedAt` set.
 *
 * The TS shape lives in `shared/transport/events/task-events.ts` so the
 * web UI can consume it without webui→server boundary inversion. The
 * Zod schema below is the runtime source of truth and carries
 * `satisfies z.ZodType<TaskHistoryEntry>` so any drift between the
 * type and the schema is a typecheck error.
 */

import {z} from 'zod'

import type {
  ReasoningContentItem,
  TaskErrorData,
  TaskHistoryEntry,
  ToolCallEvent,
} from '../../../../shared/transport/events/task-events.js'

import {TASK_HISTORY_SCHEMA_VERSION} from '../../../../shared/transport/events/task-events.js'

// Re-export for back-compat with existing server-side imports.
export type {TaskHistoryEntry, TaskHistoryStatus} from '../../../../shared/transport/events/task-events.js'
export {TASK_HISTORY_SCHEMA_VERSION} from '../../../../shared/transport/events/task-events.js'

// Inlined to break a transport/schemas.ts <-> entities/ circular import.
// Mirrors `TaskErrorDataSchema` in transport/schemas.ts; both must stay in sync.
const TaskErrorDataSchema = z.object({
  code: z.string().optional(),
  details: z.record(z.unknown()).optional(),
  message: z.string(),
  name: z.string(),
}) satisfies z.ZodType<TaskErrorData>

export const ToolCallEventSchema = z.object({
  args: z.record(z.unknown()),
  callId: z.string().optional(),
  error: z.string().optional(),
  errorType: z.string().optional(),
  result: z.unknown().optional(),
  sessionId: z.string(),
  status: z.enum(['completed', 'error', 'running']),
  timestamp: z.number(),
  toolName: z.string(),
}) satisfies z.ZodType<ToolCallEvent>

export const ReasoningContentItemSchema = z.object({
  content: z.string(),
  isThinking: z.boolean().optional(),
  timestamp: z.number(),
}) satisfies z.ZodType<ReasoningContentItem>

const TaskHistoryEntryBaseSchema = z.object({
  clientCwd: z.string().optional(),
  content: z.string(),
  createdAt: z.number(),
  files: z.array(z.string()).optional(),
  folderPath: z.string().optional(),
  id: z.string(),
  logId: z.string().optional(),
  model: z.string().optional(),
  projectPath: z.string(),
  provider: z.string().optional(),
  reasoningContents: z.array(ReasoningContentItemSchema).optional(),
  responseContent: z.string().optional(),
  schemaVersion: z.literal(TASK_HISTORY_SCHEMA_VERSION),
  sessionId: z.string().optional(),
  taskId: z.string(),
  toolCalls: z.array(ToolCallEventSchema).optional(),
  type: z.string(),
  worktreeRoot: z.string().optional(),
})

export const TaskHistoryEntrySchema = z.discriminatedUnion('status', [
  TaskHistoryEntryBaseSchema.extend({status: z.literal('created')}),
  TaskHistoryEntryBaseSchema.extend({startedAt: z.number(), status: z.literal('started')}),
  TaskHistoryEntryBaseSchema.extend({
    completedAt: z.number(),
    result: z.string().optional(),
    startedAt: z.number().optional(),
    status: z.literal('completed'),
  }),
  TaskHistoryEntryBaseSchema.extend({
    completedAt: z.number(),
    error: TaskErrorDataSchema,
    startedAt: z.number().optional(),
    status: z.literal('error'),
  }),
  TaskHistoryEntryBaseSchema.extend({
    completedAt: z.number(),
    startedAt: z.number().optional(),
    status: z.literal('cancelled'),
  }),
]) satisfies z.ZodType<TaskHistoryEntry>
