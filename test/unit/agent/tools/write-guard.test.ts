import {expect} from 'chai'
import {mkdirSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {validateWriteTarget} from '../../../../src/agent/infra/tools/write-guard.js'

describe('write-guard', () => {
  let projectRoot: string

  beforeEach(() => {
    projectRoot = join(tmpdir(), `brv-write-guard-test-${Date.now()}`)
    mkdirSync(join(projectRoot, '.brv', 'context-tree'), {recursive: true})
    // Write empty sources.json so loadSources doesn't fail
    writeFileSync(join(projectRoot, '.brv', 'sources.json'), JSON.stringify({sources: [], version: '1'}))
  })

  afterEach(() => {
    rmSync(projectRoot, {force: true, recursive: true})
  })

  it('allows writing to an existing file within the local context tree', () => {
    const file = join(projectRoot, '.brv', 'context-tree', 'existing.md')
    writeFileSync(file, '')

    const result = validateWriteTarget(file, projectRoot)

    expect(result).to.equal(null)
  })

  it('allows writing to a non-existent file within the local context tree', () => {
    const file = join(projectRoot, '.brv', 'context-tree', 'new-file.md')

    const result = validateWriteTarget(file, projectRoot)

    expect(result).to.equal(null)
  })

  it('blocks writing outside the local context tree', () => {
    const file = join(projectRoot, 'outside.md')

    const result = validateWriteTarget(file, projectRoot)

    expect(result).to.be.a('string')
    expect(result).to.include('Cannot write outside')
  })

  if (process.platform === 'darwin') {
    it('canonicalizes symlink prefixes for non-existent files (macOS /tmp → /private/tmp)', () => {
      // On macOS, /tmp is a symlink to /private/tmp.
      // tmpdir() returns the canonical /private/tmp path, but a user or tool
      // might reference files via the /tmp symlink prefix.
      const symlinkProjectRoot = projectRoot.replace(/^\/private\/tmp/, '/tmp')

      // Only run this test if the substitution actually changes the path
      // (confirms /tmp symlink is in play)
      if (symlinkProjectRoot === projectRoot) {
        return
      }

      // Target file doesn't exist — this is the ADD operation scenario.
      const targetViaSymlink = join(symlinkProjectRoot, '.brv', 'context-tree', 'new-file.md')

      const result = validateWriteTarget(targetViaSymlink, projectRoot)

      expect(result).to.equal(null)
    })
  }
})
