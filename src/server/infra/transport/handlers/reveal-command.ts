/**
 * Resolves the OS-native command for revealing a path in the system file manager.
 * Extracted so the branching can be unit-tested without spawning real processes.
 */
export type RevealCommand = {
  args: string[]
  command: string
}

export function resolveRevealCommand(platformName: NodeJS.Platform, targetPath: string): RevealCommand {
  if (platformName === 'darwin') return {args: [targetPath], command: 'open'}
  if (platformName === 'win32') return {args: [targetPath], command: 'explorer'}
  return {args: [targetPath], command: 'xdg-open'}
}
