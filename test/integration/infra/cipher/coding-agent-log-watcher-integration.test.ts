import {expect} from 'chai'
import {access, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {setTimeout} from 'node:timers/promises'
import {restore, stub} from 'sinon'

import {CleanSession} from '../../../../src/core/domain/entities/parser.js'
import {StubCodingAgentLogParser} from '../../../../src/infra/cipher/parsers/stub-coding-agent-log-parser.js'
import {CodingAgentLogWatcher} from '../../../../src/infra/cipher/watcher/coding-agent-log-watcher.js'
import {FileWatcherService} from '../../../../src/infra/watcher/file-watcher-service.js'

describe('CodingAgentLogWatcher Integration Test', () => {
  let testDir: string
  let watcher: CodingAgentLogWatcher

  beforeEach(async () => {
    // Suppress console output during tests
    stub(console, 'log')
    stub(console, 'error')
    stub(console, 'warn')

    testDir = await mkdtemp(join(tmpdir(), 'brv-test-'))
    const fileWatcherService = new FileWatcherService()
    const parser = new StubCodingAgentLogParser()
    watcher = new CodingAgentLogWatcher(fileWatcherService, parser)
  })

  afterEach(async () => {
    // Restore all sinon stubs
    restore()

    if (watcher.isWatching()) {
      await watcher.stop()
    }

    // Cleanup test directory
    try {
      await access(testDir)
      await rm(testDir, {force: true, recursive: true})
    } catch {
      // Directory doesn't exist, ignore
    }
  })

  it('should detect new files added after watch starts', async () => {
    const sessions: CleanSession[] = []
    // Start watcher with empty directory
    await watcher.start({
      async onSession(session) {
        sessions.push(session)
      },
      paths: [testDir],
    })
    const initialCount = sessions.length

    await writeFile(join(testDir, 'new-file.log'), 'new log content')
    // Might need to fine tune timeout based on file system speed (build machines can be slow)
    // It's fine for integration tests to run a bit longer anyway.
    await setTimeout(30)

    expect(sessions.length).to.be.greaterThan(initialCount)
  })

  it('should stop watching when stop() is called', async () => {
    // Start watcher
    await watcher.start({
      async onSession() {
        // No-op
      },
      paths: [testDir],
    })

    expect(watcher.isWatching()).to.be.true

    // Stop watcher
    await watcher.stop()

    expect(watcher.isWatching()).to.be.false
  })

  it('should handle multiple directories', async () => {
    // Create second test directory
    const testDir2 = await mkdtemp(join(tmpdir(), 'brv-test-'))

    try {
      // Create files in both directories
      await writeFile(join(testDir, 'file1.log'), 'content 1')
      await writeFile(join(testDir2, 'file2.log'), 'content 2')

      // Track sessions
      const sessions: CleanSession[] = []

      // Start watcher with multiple paths
      await watcher.start({
        async onSession(session) {
          sessions.push(session)
        },
        paths: [testDir, testDir2],
      })

      // Wait for events
      await setTimeout(30)

      // Verify: files from both directories should be processed
      expect(sessions).to.have.length.greaterThan(0)
    } finally {
      // Cleanup second directory
      await rm(testDir2, {force: true, recursive: true})
    }
  })

  it('should handle errors in session handler gracefully', async () => {
    // Create test file
    await writeFile(join(testDir, 'test.log'), 'content')

    let errorThrown = false

    // Start watcher with handler that throws
    await watcher.start({
      async onSession() {
        errorThrown = true
        throw new Error('Handler error')
      },
      paths: [testDir],
    })

    // Wait for events
    await setTimeout(30)

    // Verify: error was thrown but watcher continues
    expect(errorThrown).to.be.true
    expect(watcher.isWatching()).to.be.true
  })
})
