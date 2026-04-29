/**
 * Shared helpers for inspecting errors that come off the transport layer.
 *
 * The daemon serializes errors as plain objects with an optional `code` field
 * (see `serializeTaskError` / `VcError.toJSON()`), and socket.io passes them
 * through to the client unchanged — they're NOT Error instances on arrival.
 * Callers that need to branch on `error.code` should use this guard instead
 * of open-coding the shape check.
 */
export function hasCode(error: unknown): error is {code: string} {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as {code: unknown}).code === 'string'
  )
}
