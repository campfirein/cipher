import {AnalyticsEventNames} from '../event-names.js'
import {type CliInvocationProps, CliInvocationSchema} from './cli-invocation.js'
import {type DaemonStartProps, DaemonStartSchema} from './daemon-start.js'
import {type McpSessionStartProps, McpSessionStartSchema} from './mcp-session-start.js'
import {type McpToolCalledProps, McpToolCalledSchema} from './mcp-tool-called.js'
import {type TaskCompletedProps, TaskCompletedSchema} from './task-completed.js'
import {type TaskCreatedProps, TaskCreatedSchema} from './task-created.js'
import {type TaskFailedProps, TaskFailedSchema} from './task-failed.js'

/**
 * Registry of every shipped event schema, keyed by wire name. Used by:
 *   - The privacy fixture, which walks every entry and asserts no field
 *     name appears on the forbidden PII list.
 *   - Future per-event validation at emit time.
 *
 * Direct schema/type imports go through the per-event files
 * (./cli-invocation.js, ./daemon-start.js, …). This module deliberately
 * exports only the aggregate registry and the discriminated union, so it
 * never duplicates per-event re-exports.
 */
export const ALL_EVENT_SCHEMAS = {
  [AnalyticsEventNames.CLI_INVOCATION]: CliInvocationSchema,
  [AnalyticsEventNames.DAEMON_START]: DaemonStartSchema,
  [AnalyticsEventNames.MCP_SESSION_START]: McpSessionStartSchema,
  [AnalyticsEventNames.MCP_TOOL_CALLED]: McpToolCalledSchema,
  [AnalyticsEventNames.TASK_COMPLETED]: TaskCompletedSchema,
  [AnalyticsEventNames.TASK_CREATED]: TaskCreatedSchema,
  [AnalyticsEventNames.TASK_FAILED]: TaskFailedSchema,
} as const

/**
 * Discriminated union over every event in the catalog. A consumer can
 * destructure {name, properties} and TypeScript will narrow `properties`
 * against the matching per-event type.
 */
export type AnyAnalyticsEvent =
  | {name: typeof AnalyticsEventNames.CLI_INVOCATION; properties: CliInvocationProps}
  | {name: typeof AnalyticsEventNames.DAEMON_START; properties: DaemonStartProps}
  | {name: typeof AnalyticsEventNames.MCP_SESSION_START; properties: McpSessionStartProps}
  | {name: typeof AnalyticsEventNames.MCP_TOOL_CALLED; properties: McpToolCalledProps}
  | {name: typeof AnalyticsEventNames.TASK_COMPLETED; properties: TaskCompletedProps}
  | {name: typeof AnalyticsEventNames.TASK_CREATED; properties: TaskCreatedProps}
  | {name: typeof AnalyticsEventNames.TASK_FAILED; properties: TaskFailedProps}
