/**
 * Environment context information.
 * Provides awareness of the operating environment for agents and sandbox execution.
 */
export interface EnvironmentContext {
  /** Formatted .brv directory structure explanation */
  brvStructure: string
  /** Formatted project file tree */
  fileTree: string
  /** Whether the working directory is a git repository */
  isGitRepository: boolean
  /** Node.js version */
  nodeVersion: string
  /** Operating system version */
  osVersion: string
  /** Operating system platform (darwin, linux, win32) */
  platform: string
  /** Absolute path to the working directory */
  workingDirectory: string
}
