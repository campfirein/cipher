/**
 * Interface for browser launcher implementations.
 */
export interface IBrowserLauncher {
  /**
   * Launches the system browser to open the specified URL.
   * @param url The URL to open.
   * @returns A promise that resolves when the browser has been launched.
   */
  open: (url: string) => Promise<void>
}
