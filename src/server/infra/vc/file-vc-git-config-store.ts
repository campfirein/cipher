import {createHash} from 'node:crypto'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import type {IVcGitConfig, IVcGitConfigStore} from '../../core/interfaces/vc/i-vc-git-config-store.js'

import {getGlobalDataDir} from '../../utils/global-data-path.js'

export interface IFileVcGitConfigStoreDeps {
  readonly getDataDir: () => string
}

const defaultDeps: IFileVcGitConfigStoreDeps = {
  getDataDir: getGlobalDataDir,
}

function projectKey(projectPath: string): string {
  return createHash('sha1').update(projectPath).digest('hex').slice(0, 16)
}

function isIVcGitConfig(value: unknown): value is IVcGitConfig {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    (v.name === undefined || typeof v.name === 'string') &&
    (v.email === undefined || typeof v.email === 'string') &&
    (v.signingKey === undefined || typeof v.signingKey === 'string') &&
    (v.commitSign === undefined || typeof v.commitSign === 'boolean')
  )
}

export class FileVcGitConfigStore implements IVcGitConfigStore {
  private readonly deps: IFileVcGitConfigStoreDeps

  public constructor(deps: IFileVcGitConfigStoreDeps = defaultDeps) {
    this.deps = deps
  }

  public async get(projectPath: string): Promise<IVcGitConfig | undefined> {
    const configPath = this.configPath(projectPath)
    try {
      const content = await readFile(configPath, 'utf8')
      const parsed: unknown = JSON.parse(content)
      if (!isIVcGitConfig(parsed)) return undefined
      return parsed
    } catch {
      return undefined
    }
  }

  public async set(projectPath: string, config: IVcGitConfig): Promise<void> {
    const projectDir = join(this.deps.getDataDir(), 'projects', projectKey(projectPath))
    await mkdir(projectDir, {recursive: true})
    await writeFile(join(projectDir, 'vc-git-config.json'), JSON.stringify(config, null, 2), 'utf8')
  }

  private configPath(projectPath: string): string {
    return join(this.deps.getDataDir(), 'projects', projectKey(projectPath), 'vc-git-config.json')
  }
}
