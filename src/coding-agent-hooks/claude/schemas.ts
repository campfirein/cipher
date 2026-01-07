/**
 * Claude Code Hook Schemas
 *
 * Zod schemas for parsing Claude Code hook inputs and transcript format.
 * These are specific to Claude Code and NOT reusable for other coding agents.
 */

/* eslint-disable camelcase */
import {z} from 'zod'

/**
 * Helper schema for nullable optional strings.
 * Claude Code may send null, undefined, or string for optional fields.
 * This normalizes them all to string | undefined.
 */
const nullableString = z
  .string()
  .optional()
  .nullable()
  .transform((v) => v ?? undefined)

/**
 * Helper schema for nullable optional booleans.
 */
const nullableBoolean = z
  .boolean()
  .optional()
  .nullable()
  .transform((v) => v ?? undefined)

/** Hook input schema for UserPromptSubmit hook */
export const HookInputSchema = z.object({
  cwd: nullableString,
  hook_event_name: nullableString,
  permission_mode: nullableString,
  prompt: nullableString,
  session_id: nullableString,
  transcript_path: nullableString,
})

/** Stop hook input schema */
export const StopHookInputSchema = z.object({
  cwd: nullableString,
  hook_event_name: nullableString,
  session_id: nullableString,
  stop_hook_active: nullableBoolean,
  transcript_path: nullableString,
})

/** Claude Code transcript content block schema */
export const ContentBlockSchema = z.discriminatedUnion('type', [
  z.object({text: z.string(), type: z.literal('text')}),
  z.object({thinking: z.string(), type: z.literal('thinking')}),
  z.object({id: z.string(), input: z.unknown(), name: z.string(), type: z.literal('tool_use')}),
  z.object({content: z.string(), tool_use_id: z.string(), type: z.literal('tool_result')}),
])

/** Claude Code transcript entry schema */
export const TranscriptEntrySchema = z.object({
  message: z
    .object({
      content: z.union([z.string(), z.array(ContentBlockSchema)]),
      role: z.enum(['assistant', 'user']),
    })
    .optional(),
  timestamp: z.string().optional(),
  type: z.enum(['assistant', 'user', 'system', 'summary']),
})

/**
 * Claude Code session schema for hook state persistence.
 * Stores session info between UserPromptSubmit and Stop hooks.
 */
export const HookSessionSchema = z.object({
  /** Session ID from Claude Code */
  sessionId: z.string(),
  /** Timestamp when session was saved (ms since epoch) */
  timestamp: z.number(),
  /** Path to the Claude Code transcript file */
  transcriptPath: z.string(),
})

export const HookSessionDataSchema = z.object({
  sessions: z.record(z.string(), HookSessionSchema),
})

/** Inferred types */
export type HookInput = z.infer<typeof HookInputSchema>
export type StopHookInput = z.infer<typeof StopHookInputSchema>
export type ContentBlock = z.infer<typeof ContentBlockSchema>
export type TranscriptEntry = z.infer<typeof TranscriptEntrySchema>
export type HookSession = z.infer<typeof HookSessionSchema>
export type HookSessionData = z.infer<typeof HookSessionDataSchema>
