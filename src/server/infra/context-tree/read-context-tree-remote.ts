import * as git from 'isomorphic-git'
import fs from 'node:fs'
import {join} from 'node:path'

import {BRV_DIR, CONTEXT_TREE_DIR} from '../../constants.js'

/**
 * Reads a remote URL from the project's context-tree git repo
 * (`<projectPath>/.brv/context-tree/.git/config`).
 *
 * Returns `undefined` silently when the context-tree dir isn't a git repo
 * yet or the requested remote isn't configured — callers treat "no remote"
 * and "no repo" identically.
 */
export async function readContextTreeRemoteUrl(projectPath: string, remote = 'origin'): Promise<string | undefined> {
  const dir = join(projectPath, BRV_DIR, CONTEXT_TREE_DIR)
  try {
    return await git.getConfig({dir, fs, path: `remote.${remote}.url`})
  } catch {
    return undefined
  }
}
