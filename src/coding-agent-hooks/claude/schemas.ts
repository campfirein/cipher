/**
 * Claude Code Hook Schemas
 *
 * Zod schemas for parsing Claude Code hook inputs and transcript format.
 * These are specific to Claude Code and NOT reusable for other coding agents.
 */

/* eslint-disable camelcase */
import {z} from 'zod'

/** Hook input schema for UserPromptSubmit hook */
export const HookInputSchema = z.object({
  cwd: z
    .string()
    .optional()
    .nullable()
    .transform((v) => v ?? undefined),
  hook_event_name: z
    .string()
    .optional()
    .nullable()
    .transform((v) => v ?? undefined),
  permission_mode: z
    .string()
    .optional()
    .nullable()
    .transform((v) => v ?? undefined),
  prompt: z
    .string()
    .optional()
    .nullable()
    .transform((v) => v ?? undefined),
  session_id: z
    .string()
    .optional()
    .nullable()
    .transform((v) => v ?? undefined),
  transcript_path: z
    .string()
    .optional()
    .nullable()
    .transform((v) => v ?? undefined),
})

/** Stop hook input schema */
export const StopHookInputSchema = z.object({
  cwd: z
    .string()
    .optional()
    .nullable()
    .transform((v) => v ?? undefined),
  hook_event_name: z
    .string()
    .optional()
    .nullable()
    .transform((v) => v ?? undefined),
  session_id: z
    .string()
    .optional()
    .nullable()
    .transform((v) => v ?? undefined),
  stop_hook_active: z
    .boolean()
    .optional()
    .nullable()
    .transform((v) => v ?? undefined),
  transcript_path: z
    .string()
    .optional()
    .nullable()
    .transform((v) => v ?? undefined),
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

/** Claude Code session schema for hook state persistence */
export const HookSessionSchema = z.object({
  createdAt: z.number(),
  sessionId: z.string(),
  timestamp: z.number(),
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
