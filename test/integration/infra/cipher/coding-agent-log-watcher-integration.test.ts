import {expect} from 'chai'
import {access, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {setTimeout} from 'node:timers/promises'
import {restore, stub} from 'sinon'

import {ParsedInteraction} from '../../../../src/core/domain/cipher/parsed-interaction.js'
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

  it('should process existing files on first watch', async () => {
    await writeFile(join(testDir, 'existing-1.log'), 'existing log content')
    await writeFile(join(testDir, 'existing-2.json'), '{"message": "existing json"}')

    const interactions: ParsedInteraction[] = []
    await watcher.start({
      async onInteraction(interaction) {
        interactions.push(interaction)
      },
      paths: [testDir],
    })

    expect(interactions).to.have.length.greaterThan(0)
    expect(watcher.isWatching()).to.be.true
  })

  it('should detect new files added after watch starts', async () => {
    const interactions: ParsedInteraction[] = []
    // Start watcher with empty directory
    await watcher.start({
      async onInteraction(interaction) {
        interactions.push(interaction)
      },
      paths: [testDir],
    })
    const initialCount = interactions.length

    await writeFile(join(testDir, 'new-file.log'), 'new log content')
    // Might need to fine tune timeout based on file system speed (build machines can be slow)
    // It's fine for integration tests to run a bit longer anyway.
    await setTimeout(30)

    expect(interactions.length).to.be.greaterThan(initialCount)
  })

  it('should stop watching when stop() is called', async () => {
    // Start watcher
    await watcher.start({
      async onInteraction() {
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

      // Track interactions
      const interactions: ParsedInteraction[] = []

      // Start watcher with multiple paths
      await watcher.start({
        async onInteraction(interaction) {
          interactions.push(interaction)
        },
        paths: [testDir, testDir2],
      })

      // Wait for events
      await setTimeout(30)

      // Verify: files from both directories should be processed
      expect(interactions).to.have.length.greaterThan(0)
    } finally {
      // Cleanup second directory
      await rm(testDir2, {force: true, recursive: true})
    }
  })

  it('should only process valid log files', async () => {
    // Create mix of valid and invalid files
    await writeFile(join(testDir, 'valid.log'), 'log content')
    await writeFile(join(testDir, 'valid.json'), 'json content')
    await writeFile(join(testDir, 'invalid.txt'), 'text content')
    await writeFile(join(testDir, 'invalid.md'), 'markdown content')

    // Track interactions
    const interactions: ParsedInteraction[] = []

    // Start watcher
    await watcher.start({
      async onInteraction(interaction) {
        interactions.push(interaction)
      },
      paths: [testDir],
    })

    // Wait for events (longer timeout for file system events)
    await setTimeout(30)

    // Verify: only valid files should be processed
    // Each valid file returns 2 mock interactions from StubCodingAgentLogParser
    // Should have at least some interactions from valid files
    expect(interactions.length).to.be.greaterThan(0)
    expect(interactions.length).to.be.at.most(4) // 2 files * 2 interactions each max
  })

  it('should handle errors in interaction handler gracefully', async () => {
    // Create test file
    await writeFile(join(testDir, 'test.log'), 'content')

    let errorThrown = false

    // Start watcher with handler that throws
    await watcher.start({
      async onInteraction() {
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
