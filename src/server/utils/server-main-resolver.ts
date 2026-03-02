import {dirname, join, sep} from 'node:path'
import {fileURLToPath} from 'node:url'

/**
 * Resolves the path to brv-server.js relative to this CLI installation.
 *
 * Uses import.meta.url to locate the dist/ directory.
 * In development (tsx): this file is at src/server/utils/
 * In production: this file is at dist/server/utils/
 * Target: dist/server/infra/daemon/brv-server.js
 */
export function resolveLocalServerMainPath(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url))
  const baseDir = currentDir.includes(`${sep}src${sep}`)
    ? currentDir.replace(`${sep}src${sep}`, `${sep}dist${sep}`)
    : currentDir
  return join(baseDir, '..', 'infra', 'daemon', 'brv-server.js')
}
