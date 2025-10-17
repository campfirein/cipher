/**
 * Interface for browser launcher implementations.
 */
export interface IBrowserLauncher {
  open: (url: string) => Promise<void>
}
