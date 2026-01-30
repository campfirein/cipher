/**
 * Error thrown when the BrvConfig version is missing or incompatible.
 *
 * This error is used to detect outdated `.brv/config.json` files that need
 * to be reinitialized via `brv init`.
 */
export class BrvConfigVersionError extends Error {
  /** The version found in the config file, or undefined if missing. */
  public readonly currentVersion: string | undefined
  /** The version expected by the current CLI. */
  public readonly expectedVersion: string

  public constructor(params: {currentVersion: string | undefined; expectedVersion: string}) {
    const message = params.currentVersion
      ? `Config version mismatch (found: ${params.currentVersion}, expected: ${params.expectedVersion}). Please run 'brv init' to reinitialize.`
      : `Config version missing. Please run 'brv init' to reinitialize.`

    super(message)
    this.name = 'BrvConfigVersionError'
    this.currentVersion = params.currentVersion
    this.expectedVersion = params.expectedVersion
  }
}
