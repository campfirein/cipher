// Both optional — user sets name/email separately, one at a time (like git config)
export interface IVcGitConfig {
  email?: string
  name?: string
}

export interface IVcGitConfigStore {
  get(projectPath: string): Promise<IVcGitConfig | undefined>
  set(projectPath: string, config: IVcGitConfig): Promise<void>
}
