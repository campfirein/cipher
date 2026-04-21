import {expect} from 'chai'
import * as git from 'isomorphic-git'
import fs, {mkdirSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {readContextTreeRemoteUrl} from '../../../../src/server/infra/context-tree/read-context-tree-remote.js'

function makeTmpProject(): string {
  const path = join(tmpdir(), `brv-remote-url-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`)
  mkdirSync(join(path, '.brv', 'context-tree'), {recursive: true})
  return path
}

describe('readContextTreeRemoteUrl', () => {
  let projectPath: string

  beforeEach(() => {
    projectPath = makeTmpProject()
  })

  afterEach(() => {
    rmSync(projectPath, {force: true, recursive: true})
  })

  it('returns the remote URL when the context-tree git repo has one configured', async () => {
    const contextTreeDir = join(projectPath, '.brv', 'context-tree')
    await git.init({dir: contextTreeDir, fs})
    await git.setConfig({dir: contextTreeDir, fs, path: 'remote.origin.url', value: 'https://example.com/acme/repo.git'})

    const result = await readContextTreeRemoteUrl(projectPath)
    expect(result).to.equal('https://example.com/acme/repo.git')
  })

  it('returns undefined when the context-tree dir is not a git repo', async () => {
    const result = await readContextTreeRemoteUrl(projectPath)
    expect(result).to.equal(undefined)
  })

  it('returns undefined when the git repo has no remote configured', async () => {
    const contextTreeDir = join(projectPath, '.brv', 'context-tree')
    await git.init({dir: contextTreeDir, fs})

    const result = await readContextTreeRemoteUrl(projectPath)
    expect(result).to.equal(undefined)
  })

  it('reads a non-default remote name when one is passed', async () => {
    const contextTreeDir = join(projectPath, '.brv', 'context-tree')
    await git.init({dir: contextTreeDir, fs})
    await git.setConfig({dir: contextTreeDir, fs, path: 'remote.upstream.url', value: 'https://example.com/owner/fork.git'})

    const result = await readContextTreeRemoteUrl(projectPath, 'upstream')
    expect(result).to.equal('https://example.com/owner/fork.git')
  })

  it('returns undefined for a non-existent project path (no throw)', async () => {
    const missingPath = join(tmpdir(), `brv-remote-url-missing-${Date.now()}`)
    const result = await readContextTreeRemoteUrl(missingPath)
    expect(result).to.equal(undefined)
  })
})
