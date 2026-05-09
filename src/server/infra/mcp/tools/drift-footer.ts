import {versionsAreEquivalent} from '@campfirein/brv-transport-client'

/**
 * Appends a version-drift footer to MCP tool text responses when the MCP
 * client and the running daemon are at different versions.
 *
 * Returns the body unchanged when versions match or when the daemon hasn't
 * reported its version yet (pre-fix daemon during a rolling upgrade).
 */
export function appendDriftFooter(body: string, clientVersion: string, daemonVersion?: string): string {
  if (!daemonVersion || versionsAreEquivalent(clientVersion, daemonVersion)) {
    return body
  }

  return (
    body +
    `\n\n---\nNote: this brv MCP is at ${clientVersion} while the running daemon is at ${daemonVersion}. ` +
    `The protocol is backward-compatible. Restart your IDE to align versions.`
  )
}
