import {expect} from 'chai'
import sinon, {stub} from 'sinon'

import type {CleanSession} from '../../../../../src/core/domain/entities/parser.js'
import type {ICodingAgentLogParser} from '../../../../../src/core/interfaces/cipher/i-coding-agent-log-parser.js'
import type {FileEvent, IFileWatcherService} from '../../../../../src/core/interfaces/i-file-watcher-service.js'

import {CodingAgentLogWatcher} from '../../../../../src/infra/cipher/watcher/coding-agent-log-watcher.js'

const createMockSession = (filePath: string): CleanSession => ({
  id: `mock-session-${Date.now()}`,
  messages: [
    {
      content: [{text: 'Mock message', type: 'text'}],
      timestamp: new Date().toISOString(),
      type: 'user',
    },
    {
      content: [{text: 'Mock response', type: 'text'}],
      timestamp: new Date().toISOString(),
      type: 'assistant',
    },
  ],
  metadata: {
    originalFile: filePath,
    source: 'test',
  },
  timestamp: Date.now(),
  title: 'Mock Session',
  type: 'Claude',
  workspacePaths: [],
})

describe('CodingAgentLogWatcher', () => {
  let watcher: CodingAgentLogWatcher
  let mockFileWatcher: sinon.SinonStubbedInstance<IFileWatcherService>
  let mockParser: sinon.SinonStubbedInstance<ICodingAgentLogParser>
  let fileEventHandler: ((event: FileEvent) => Promise<void>) | undefined

  beforeEach(() => {
    // Create mock file watcher
    mockFileWatcher = {
      setFileEventHandler: stub<[(event: FileEvent) => Promise<void>], void>(),
      start: stub<[paths: string[]], Promise<void>>().resolves(),
      stop: stub<[], Promise<void>>().resolves(),
    }

    // Capture the file event handler when it's set
    mockFileWatcher.setFileEventHandler.callsFake((handler) => {
      fileEventHandler = handler
    })

    // Create mock parser
    mockParser = {
      parseLogFile: stub<[], Promise<readonly CleanSession[]>>(),
    }

    watcher = new CodingAgentLogWatcher(mockFileWatcher, mockParser)
  })

  afterEach(() => {
    fileEventHandler = undefined
  })

  describe('isWatching', () => {
    it('should return false initially', () => {
      expect(watcher.isWatching()).to.be.false
    })

    it('should return true after start', async () => {
      await watcher.start({
        onSession: stub(),
        paths: ['/test/path'],
      })

      expect(watcher.isWatching()).to.be.true
    })

    it('should return false after stop', async () => {
      await watcher.start({
        onSession: stub(),
        paths: ['/test/path'],
      })
      await watcher.stop()

      expect(watcher.isWatching()).to.be.false
    })
  })

  describe('start', () => {
    it('should register file event handler', async () => {
      await watcher.start({
        onSession: stub(),
        paths: ['/test/path'],
      })

      expect(mockFileWatcher.setFileEventHandler.calledOnce).to.be.true
    })

    it('should start file watcher with provided paths', async () => {
      const paths = ['/path1', '/path2']
      await watcher.start({
        onSession: stub(),
        paths,
      })

      expect(mockFileWatcher.start.calledOnce).to.be.true
      expect(mockFileWatcher.start.calledWith(paths)).to.be.true
    })

    it('should throw error if already watching', async () => {
      await watcher.start({
        onSession: stub(),
        paths: ['/test/path'],
      })

      try {
        await watcher.start({
          onSession: stub(),
          paths: ['/test/path'],
        })
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.include('Already watching')
      }
    })
  })

  describe('stop', () => {
    it('should stop file watcher', async () => {
      await watcher.start({
        onSession: stub(),
        paths: ['/test/path'],
      })
      await watcher.stop()

      expect(mockFileWatcher.stop.calledOnce).to.be.true
    })

    it('should not throw error if not watching', async () => {
      await watcher.stop()
      // Should not throw
    })
  })

  describe('file event handling', () => {
    it('should process add events for valid log files', async () => {
      const onSession = stub().resolves()
      const mockSession = createMockSession('/test/file.log')

      mockParser.parseLogFile.resolves([mockSession])

      await watcher.start({
        onSession,
        paths: ['/test/path'],
      })

      // Simulate file add event
      const fileEvent: FileEvent = {
        path: '/test/file.log',
        type: 'add',
      }
      await fileEventHandler?.(fileEvent)

      expect(mockParser.parseLogFile.calledOnce).to.be.true
      expect(onSession.calledOnce).to.be.true
      expect(onSession.calledWith(mockSession)).to.be.true
    })

    it('should process change events for valid log files', async () => {
      const onSession = stub().resolves()
      const mockSession = createMockSession('/test/file.log')

      mockParser.parseLogFile.resolves([mockSession])

      await watcher.start({
        onSession,
        paths: ['/test/path'],
      })

      const fileEvent: FileEvent = {
        path: '/test/file.log',
        type: 'change',
      }
      await fileEventHandler?.(fileEvent)

      expect(onSession.calledOnce).to.be.true
    })

    it('should ignore unlink events', async () => {
      const onSession = stub().resolves()

      await watcher.start({
        onSession,
        paths: ['/test/path'],
      })

      const fileEvent: FileEvent = {
        path: '/test/file.log',
        type: 'unlink',
      }
      await fileEventHandler?.(fileEvent)

      expect(mockParser.parseLogFile.called).to.be.false
      expect(onSession.called).to.be.false
    })

    it('should ignore addDir events', async () => {
      const onSession = stub().resolves()

      await watcher.start({
        onSession,
        paths: ['/test/path'],
      })

      const fileEvent: FileEvent = {
        path: '/test/dir',
        type: 'addDir',
      }
      await fileEventHandler?.(fileEvent)

      expect(mockParser.parseLogFile.called).to.be.false
      expect(onSession.called).to.be.false
    })

    it('should invoke callback for each session from parser', async () => {
      const onSession = stub().resolves()
      const sessions = [createMockSession('/test/file.log'), createMockSession('/test/file.log')]

      mockParser.parseLogFile.resolves(sessions)

      await watcher.start({
        onSession,
        paths: ['/test/path'],
      })

      const fileEvent: FileEvent = {
        path: '/test/file.log',
        type: 'add',
      }
      await fileEventHandler?.(fileEvent)

      expect(onSession.callCount).to.equal(2)
      expect(onSession.firstCall.calledWith(sessions[0])).to.be.true
      expect(onSession.secondCall.calledWith(sessions[1])).to.be.true
    })
  })

  describe('error handling', () => {
    it('should handle parser errors gracefully', async () => {
      const onSession = stub().resolves()

      mockParser.parseLogFile.rejects(new Error('Parse error'))

      await watcher.start({
        onSession,
        paths: ['/test/path'],
      })

      const fileEvent: FileEvent = {
        path: '/test/file.log',
        type: 'add',
      }

      // Should not throw
      await fileEventHandler?.(fileEvent)

      expect(onSession.called).to.be.false
    })

    it('should handle callback errors gracefully', async () => {
      const onSession = stub().rejects(new Error('Callback error'))
      const mockSession = createMockSession('/test/file.log')

      mockParser.parseLogFile.resolves([mockSession])

      await watcher.start({
        onSession,
        paths: ['/test/path'],
      })

      const fileEvent: FileEvent = {
        path: '/test/file.log',
        type: 'add',
      }

      // Should not throw
      await fileEventHandler?.(fileEvent)

      expect(onSession.calledOnce).to.be.true
    })
  })

  describe('first watch behavior', () => {
    it('should process files on first watch', async () => {
      const onSession = stub().resolves()
      const mockSession = createMockSession('/test/file.log')

      mockParser.parseLogFile.resolves([mockSession])

      await watcher.start({
        onSession,
        paths: ['/test/path'],
      })

      const fileEvent: FileEvent = {
        path: '/test/file.log',
        type: 'add',
      }
      await fileEventHandler?.(fileEvent)

      expect(onSession.calledOnce).to.be.true
    })

    it('should process change events even for previously seen files', async () => {
      const onSession = stub().resolves()
      const mockSession = createMockSession('/test/file.log')

      mockParser.parseLogFile.resolves([mockSession])

      await watcher.start({
        onSession,
        paths: ['/test/path'],
      })

      // First: add event
      const addEvent: FileEvent = {
        path: '/test/file.log',
        type: 'add',
      }
      await fileEventHandler?.(addEvent)

      // Stop and restart
      await watcher.stop()
      await watcher.start({
        onSession,
        paths: ['/test/path'],
      })

      // Second: change event for same file
      const changeEvent: FileEvent = {
        path: '/test/file.log',
        type: 'change',
      }
      await fileEventHandler?.(changeEvent)

      // Should be called twice (add + change)
      expect(onSession.calledTwice).to.be.true
    })
  })
})
