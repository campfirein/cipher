import {expect} from 'chai'
import {existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'

import {ensureGitignoreEntries} from '../../../src/server/utils/gitignore.js'

describe('ensureGitignoreEntries', () => {
  let testDir: string

  beforeEach(() => {
    const rawTestDir = path.join(tmpdir(), `gitignore-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(rawTestDir, {recursive: true})
    testDir = realpathSync(rawTestDir)
  })

  afterEach(() => {
    try {
      rmSync(testDir, {force: true, recursive: true})
    } catch {
      // Ignore cleanup errors
    }
  })

  it('should add entries to a new .gitignore in a git repo', async () => {
    mkdirSync(path.join(testDir, '.git'))

    await ensureGitignoreEntries(testDir)

    const content = readFileSync(path.join(testDir, '.gitignore'), 'utf8')
    expect(content).to.include('# ByteRover')
    expect(content).to.include('.brv/*')
    expect(content).to.include('!.brv/context-tree/')
    expect(content).to.include('.brv/context-tree/.git')
  })

  it('should append to an existing .gitignore preserving original content', async () => {
    mkdirSync(path.join(testDir, '.git'))
    writeFileSync(path.join(testDir, '.gitignore'), 'node_modules/\ndist/\n')

    await ensureGitignoreEntries(testDir)

    const content = readFileSync(path.join(testDir, '.gitignore'), 'utf8')
    expect(content).to.include('node_modules/')
    expect(content).to.include('dist/')
    expect(content).to.include('# ByteRover')
    expect(content).to.include('.brv/*')
    expect(content).to.include('!.brv/context-tree/')
    expect(content).to.include('.brv/context-tree/.git')
  })

  it('should be idempotent — no duplicates on re-run', async () => {
    mkdirSync(path.join(testDir, '.git'))

    await ensureGitignoreEntries(testDir)
    await ensureGitignoreEntries(testDir)

    const content = readFileSync(path.join(testDir, '.gitignore'), 'utf8')
    const matches = content.match(/\.brv\/\*/g)
    expect(matches).to.have.lengthOf(1)
  })

  it('should not create .gitignore in a non-git directory', async () => {
    await ensureGitignoreEntries(testDir)

    expect(existsSync(path.join(testDir, '.gitignore'))).to.be.false
  })

  it('should add a trailing newline before entries if existing file lacks one', async () => {
    mkdirSync(path.join(testDir, '.git'))
    writeFileSync(path.join(testDir, '.gitignore'), 'node_modules/')

    await ensureGitignoreEntries(testDir)

    const content = readFileSync(path.join(testDir, '.gitignore'), 'utf8')
    // Should have a blank line separating existing content from new entries
    expect(content).to.include('node_modules/\n\n# ByteRover')
  })

  it('should handle an empty existing .gitignore', async () => {
    mkdirSync(path.join(testDir, '.git'))
    writeFileSync(path.join(testDir, '.gitignore'), '')

    await ensureGitignoreEntries(testDir)

    const content = readFileSync(path.join(testDir, '.gitignore'), 'utf8')
    expect(content).to.include('# ByteRover')
    expect(content).to.include('.brv/*')
    expect(content).to.include('!.brv/context-tree/')
    expect(content).to.include('.brv/context-tree/.git')
  })
})
