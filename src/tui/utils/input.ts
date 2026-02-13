/**
 * Input Utilities
 *
 * Helpers for cleaning terminal input artifacts.
 */

/**
 * Strip bracketed paste mode escape sequences from input.
 *
 * When pasting text in a terminal, it wraps the content with ESC[200~ ... ESC[201~.
 * The `ink` library doesn't handle these sequences, so pasted text (e.g. API keys)
 * gets corrupted with them. The leading ESC (\x1b) may already be stripped by
 * ink's useInput hook, so we match both with and without it.
 */
export function stripBracketedPaste(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.replaceAll(/\u001B?\[200~/g, '').replaceAll(/\u001B?\[201~/g, '')
}
