import {mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import type {CLIResult} from './cli-runner.js'
import type {E2eConfig} from './env-guard.js'

import {BRV_CONFIG_VERSION, BRV_DIR, PROJECT_CONFIG_FILE} from '../../../src/server/constants.js'
import {runBrv} from './cli-runner.js'

export type JsonResult<T> = {
  command: string
  data: T
  success: boolean
  timestamp: string
}

export type RunOptions = {
  env?: Record<string, string>
  timeout?: number
}

export class BrvE2eHelper {
  private _cwd: string | undefined
  private readonly config: E2eConfig
  private teardowns: Array<() => Promise<void>> = []

  constructor(config: E2eConfig) {
    this.config = config
  }

  get cwd(): string {
    if (!this._cwd) {
      throw new Error('setup() must be called before accessing cwd')
    }

    return this._cwd
  }

  async cleanup(): Promise<void> {
    if (!this._cwd) return

    const dir = this._cwd

    // Run teardowns in reverse order (LIFO), continue even if one throws
    for (let i = this.teardowns.length - 1; i >= 0; i--) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await this.teardowns[i]()
      } catch {
        // Swallow — cleanup must always complete
      }
    }

    this.teardowns = []
    this._cwd = undefined
    rmSync(dir, {force: true, recursive: true})
  }

  async login(): Promise<void> {
    const result = await this.runJson('login', ['--api-key', this.config.apiKey])
    if (!result.success) {
      throw new Error(`Login failed: ${JSON.stringify(result.data)}`)
    }

    // Auto-register logout as teardown
    this.onTeardown(async () => {
      try {
        await this.runJson('logout')
      } catch {
        // Best-effort logout during cleanup
      }
    })
  }

  async logout(): Promise<void> {
    const result = await this.runJson('logout')
    if (!result.success) {
      throw new Error(`Logout failed: ${JSON.stringify(result.data)}`)
    }
  }

  onTeardown(fn: () => Promise<void>): void {
    this.teardowns.push(fn)
  }

  async run(command: string, args?: string[], opts?: RunOptions): Promise<CLIResult> {
    return runBrv({
      args: [command, ...(args ?? [])],
      config: this.config,
      cwd: this.cwd,
      ...opts,
    })
  }

  async runJson<T>(command: string, args?: string[], opts?: RunOptions): Promise<JsonResult<T>> {
    const result = await this.run(command, [...(args ?? []), '--format', 'json'], opts)
    const lines = result.stdout.trim().split('\n')

    // Find the last valid JSON line (CLI may print non-JSON before it)
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim()
      if (!line) continue
      try {
        return JSON.parse(line) as JsonResult<T>
      } catch {
        // Not JSON, try next line
      }
    }

    throw new Error(`No valid JSON found in CLI output.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`)
  }

  async setup(): Promise<void> {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'brv-e2e-')))
    const brvDir = join(dir, BRV_DIR)

    mkdirSync(brvDir, {recursive: true})
    writeFileSync(join(brvDir, PROJECT_CONFIG_FILE), JSON.stringify({version: BRV_CONFIG_VERSION}))

    this._cwd = dir
  }
}
