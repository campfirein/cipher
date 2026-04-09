// Both optional — user sets fields separately, one at a time (like git config)
export interface IVcGitConfig {
  /** Auto-sign all commits when true (default: false) */
  commitSign?: boolean
  email?: string
  name?: string
  /** Path to SSH private key for signing (e.g., "~/.ssh/id_ed25519") */
  signingKey?: string
}

export interface IVcGitConfigStore {
  get(projectPath: string): Promise<IVcGitConfig | undefined>
  set(projectPath: string, config: IVcGitConfig): Promise<void>
}
