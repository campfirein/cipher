/**
 * Helper for rejecting flags that have been removed from a CLI command,
 * with a clear migration message instead of oclif's default `Nonexistent
 * flag` error.
 *
 * Usage in a command's `run()`:
 *
 *   assertNoRemovedFlags(process.argv.slice(2), CURATE_REMOVED_FLAGS)
 *   const {flags} = await this.parse(MyCommand)
 *
 * The scan runs before `this.parse()` so the user sees the migration text
 * regardless of whether the command is strict-parse (oclif's default) or
 * permissive (`public static strict = false`).
 */

export type RemovedFlag = {
  /** Flag tokens to detect (long form first, then any short aliases). */
  flags: string[]
  /** One-sentence guidance the user should follow instead. */
  migration: string
}

const formatRejection = (token: string, migration: string): string =>
  `Flag '${token}' was removed in tool-mode. ${migration}`

/**
 * Scan an argv slice for any removed flag and throw with a migration
 * message on the first match. Recognises both `--flag value` and
 * `--flag=value` forms.
 */
export function assertNoRemovedFlags(argv: string[], removed: RemovedFlag[]): void {
  for (const {flags, migration} of removed) {
    for (const token of flags) {
      const equalsPrefix = `${token}=`
      const hit = argv.find((a) => a === token || a.startsWith(equalsPrefix))
      if (hit) {
        throw new Error(formatRejection(token, migration))
      }
    }
  }
}

/**
 * Flags removed from `brv curate` as of the tool-mode cleanup
 * (see Linear ENG-2880). All four were no-ops in tool-mode — kept as
 * dead declarations until the cleanup; surfaced here so any agent or
 * script still passing them gets a clear migration message.
 */
export const CURATE_REMOVED_FLAGS: RemovedFlag[] = [
  {
    flags: ['--folder', '-d'],
    migration:
      'Pack the folder content into the <bv-topic> HTML directly before calling brv curate.',
  },
  {
    flags: ['--files', '-f'],
    migration:
      'Read the files and inline the relevant content into the <bv-topic> HTML directly.',
  },
  {
    flags: ['--detach'],
    migration:
      'Tool-mode curate runs as two cheap RPCs (kickoff + continuation); --detach is unnecessary.',
  },
  {
    flags: ['--timeout'],
    migration:
      'Tool-mode curate has no long-running daemon LLM call; --timeout is unnecessary.',
  },
]

/**
 * Flags removed from `brv query` as of the tool-mode cleanup
 * (see Linear ENG-2880).
 */
export const QUERY_REMOVED_FLAGS: RemovedFlag[] = [
  {
    flags: ['--timeout'],
    migration:
      'Tool-mode query is a deterministic local BM25 lookup; --timeout is unnecessary.',
  },
]
