import {expect} from 'chai'
import {access, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {setTimeout} from 'node:timers/promises'
import {restore, stub} from 'sinon'

import type {Agent} from '../../../../src/core/domain/entities/agent.js'
import type {CleanSession} from '../../../../src/core/domain/entities/parser.js'
import type {ICodingAgentLogParser} from '../../../../src/core/interfaces/cipher/i-coding-agent-log-parser.js'

import {CodingAgentLogWatcher} from '../../../../src/infra/cipher/watcher/coding-agent-log-watcher.js'
import {FileWatcherService} from '../../../../src/infra/watcher/file-watcher-service.js'

/**
 * Test parser that returns mock sessions for integration testing.
 * This allows the integration test to focus on the watcher's file detection behavior
 * without depending on the real parser's implementation details.
 */
class TestCodingAgentLogParser implements ICodingAgentLogParser {
  async parse(chatLogPath: string, ide: Agent): Promise<readonly CleanSession[]> {
    const mockSession: CleanSession = {
      id: `test-session-${Date.now()}`,
      messages: [
        {
          content: [{text: 'Test message', type: 'text'}],
          timestamp: new Date().toISOString(),
          type: 'user',
        },
      ],
      metadata: {
        originalFile: chatLogPath,
        source: ide,
      },
      timestamp: Date.now(),
      title: 'Test Session',
      type: 'Claude',
      workspacePaths: [],
    }
    return [mockSession]
  }
}

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
    const parser = new TestCodingAgentLogParser()
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
      codingAgentInfo: {
        chatLogPath: testDir,
        name: 'Github Copilot',
      },
      async onCleanSession(session) {
        sessions.push(session)
      },
    })
    const initialCount = sessions.length

    await writeFile(join(testDir, 'new-file.log'), 'new log content')
    // Might need to fine tune timeout based on file system speed (build machines can be slow)
    // It's fine for integration tests to run a bit longer anyway.
    await setTimeout(500)

    expect(sessions.length).to.be.greaterThan(initialCount)
  })

  it('should stop watching when stop() is called', async () => {
    // Start watcher
    await watcher.start({
      codingAgentInfo: {
        chatLogPath: testDir,
        name: 'Github Copilot',
      },
      async onCleanSession() {
        // No-op
      },
    })

    expect(watcher.isWatching()).to.be.true

    // Stop watcher
    await watcher.stop()

    expect(watcher.isWatching()).to.be.false
  })

  it('should handle errors in session handler gracefully', async () => {
    // Create test file
    await writeFile(join(testDir, 'test.log'), 'content')

    let errorThrown = false

    // Start watcher with handler that throws
    await watcher.start({
      codingAgentInfo: {
        chatLogPath: testDir,
        name: 'Github Copilot',
      },
      async onCleanSession() {
        errorThrown = true
        throw new Error('Handler error')
      },
    })

    // Wait for events
    await setTimeout(30)

    // Verify: error was thrown but watcher continues
    expect(errorThrown).to.be.true
    expect(watcher.isWatching()).to.be.true
  })
})
