/**
 * Result from OAuth callback containing authorization code and state.
 */
export type CallbackResult = {
  code: string
  state: string
}

/**
 * Interface for handling OAuth callback during authentication flow.
 * Implementations manage a local HTTP server that receives OAuth redirect.
 */
export interface ICallbackHandler {
  /**
   * Get the current port of the callback server.
   * @returns The port number if server is running, undefined otherwise.
   */
  getPort(): number | undefined

  /**
   * Start the callback server.
   * @returns Promise that resolves with the port number the server is listening on.
   */
  start(): Promise<number>

  /**
   * Stop the callback server.
   * @returns Promise that resolves when the server is stopped.
   */
  stop(): Promise<void>

  /**
   * Wait for OAuth callback with timeout.
   * @param expectedState The state parameter to validate against CSRF attacks.
   * @param timeoutMs Timeout in milliseconds.
   * @returns Promise that resolves with the authorization code and state, or rejects on timeout or state mismatch.
   */
  waitForCallback(expectedState: string, timeoutMs: number): Promise<CallbackResult>
}
