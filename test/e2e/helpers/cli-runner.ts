import {execFile} from 'node:child_process'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

import type {E2eConfig} from './env-guard.js'

export type CLIResult = {
  exitCode: number
  stderr: string
  stdout: string
}

export type RunBrvOptions = {
  args: string[]
  config: E2eConfig
  cwd?: string
  env?: Record<string, string>
  timeout?: number
}

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const BIN_DEV_PATH = resolve(PROJECT_ROOT, 'bin', 'dev.js')
// Resolve tsx from project root so it works even when cwd is a temp dir
const TSX_IMPORT_PATH = resolve(PROJECT_ROOT, 'node_modules', 'tsx', 'dist', 'esm', 'index.mjs')

export function runBrv(opts: RunBrvOptions): Promise<CLIResult> {
  const {args, config, cwd, env, timeout = 60_000} = opts

  const childEnv: Record<string, string> = {
    ...process.env as Record<string, string>,
    BRV_API_BASE_URL: config.apiBaseUrl,
    BRV_COGIT_API_BASE_URL: config.cogitApiBaseUrl,
    BRV_E2E_API_KEY: config.apiKey,
    BRV_ENV: 'development',
    BRV_GIT_REMOTE_BASE_URL: config.gitRemoteBaseUrl,
    BRV_LLM_API_BASE_URL: config.llmApiBaseUrl,
    BRV_WEB_APP_URL: config.webAppUrl,
    ...env,
  }

  // Use node explicitly with tsx import path instead of the shebang,
  // so tsx resolves correctly regardless of the child process cwd
  const nodeArgs = ['--import', TSX_IMPORT_PATH, '--no-warnings', BIN_DEV_PATH, ...args]

  return new Promise((resolve) => {
    execFile(process.execPath, nodeArgs, {cwd, env: childEnv, maxBuffer: 10 * 1024 * 1024, timeout}, (error, stdout, stderr) => {
      if (error) {
        // execFile rejects on non-zero exit — extract result instead of throwing
        const exitCode = typeof error.code === 'number' ? error.code : 1
        resolve({
          exitCode,
          stderr: stderr || error.message,
          stdout: stdout || '',
        })
        return
      }

      resolve({exitCode: 0, stderr: stderr || '', stdout: stdout || ''})
    })
  })
}
