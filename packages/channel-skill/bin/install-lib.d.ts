export declare const HOST_TO_PATH: Readonly<{
  claude: string
  codex: string
  pi: string
}>

export declare const DEFAULT_TARGET_PATHS: readonly ['claude', 'codex', 'pi']

export declare function resolveTargets(opts: {
  homeDir: string
  target?: string
  customPath?: string
}): string[]

export type InstallResult = {
  written: string[]
  skipped: string[]
}

export declare function install(opts: {
  skillSource: string
  targets: string[]
  dryRun?: boolean
  force?: boolean
}): Promise<InstallResult>
