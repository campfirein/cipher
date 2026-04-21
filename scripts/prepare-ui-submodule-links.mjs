import {constants} from 'node:fs'
import {access, lstat, mkdir, rm, symlink} from 'node:fs/promises'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const submoduleRoot = resolve(repoRoot, 'packages/byterover-packages')

const workspaceLinks = [
  {
    linkPath: resolve(submoduleRoot, 'node_modules/@workspace/typescript-config'),
    targetPath: resolve(submoduleRoot, 'typescript-config'),
  },
]

try {
  await access(submoduleRoot, constants.F_OK)
} catch {
  console.error(
    'Shared UI submodule not found at packages/byterover-packages. Run `git submodule update --init --recursive`.',
  )
  // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
  process.exit(1)
}

for (const {linkPath, targetPath} of workspaceLinks) {
  // eslint-disable-next-line no-await-in-loop
  await mkdir(dirname(linkPath), {recursive: true})

  try {
    // eslint-disable-next-line no-await-in-loop
    await lstat(linkPath)
    // eslint-disable-next-line no-await-in-loop
    await rm(linkPath, {force: true, recursive: true})
  } catch (error) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') {
      throw error
    }
  }

  // eslint-disable-next-line no-await-in-loop
  await symlink(targetPath, linkPath, 'junction')
}
