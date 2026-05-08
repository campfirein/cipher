/* eslint-disable camelcase */
import {z} from 'zod'

/**
 * Per-event schema for `cli_invocation`.
 *
 * Every field is a user CHOICE (env, runtime, flag NAMES) — flag VALUES are
 * never captured because they may carry file paths, query text, or secrets.
 *
 * `command_id` is the oclif command identifier (e.g. "vc:add", "query",
 * "curate:learn"). It is intentionally typed as a free string here:
 * the oclif manifest is the source of truth and changes per release;
 * mirroring the full ~80-entry list in TypeScript would rot quickly.
 */
export const CliInvocationSchema = z
  .object({
    command_id: z.string().min(1),
    flag_names: z.array(z.string()),
    is_ci: z.boolean(),
    is_tty: z.boolean(),
    package_manager: z.enum(['npm', 'yarn', 'pnpm', 'bun', 'unknown']),
    runtime: z.enum(['node', 'bun']),
    terminal_program: z.string().min(1).optional(),
  })
  .strict()

export type CliInvocationProps = z.infer<typeof CliInvocationSchema>
