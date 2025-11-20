import {expect} from 'chai'
import sinon, {stub} from 'sinon'

import type {ParsedInteraction} from '../../../../../src/core/domain/cipher/parsed-interaction.js'
import type {ICodingAgentLogParser} from '../../../../../src/core/interfaces/cipher/i-coding-agent-log-parser.js'
import type {FileEvent, IFileWatcherService} from '../../../../../src/core/interfaces/i-file-watcher-service.js'

import {CodingAgentLogWatcher} from '../../../../../src/infra/cipher/watcher/coding-agent-log-watcher.js'

const createMockInteraction = (filePath: string): ParsedInteraction => ({
  agentResponse: 'Mock response',
  agentType: 'stub',
  metadata: {
    originalFile: filePath,
    source: 'test',
  },
  timestamp: Date.now(),
  userMessage: 'Mock message',
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
      isValidLogFile: stub<[filePath: string], boolean>().returns(true),
      parseLogFile: stub<[filePath: string], Promise<ParsedInteraction[]>>(),
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
        onInteraction: stub(),
        paths: ['/test/path'],
      })

      expect(watcher.isWatching()).to.be.true
    })

    it('should return false after stop', async () => {
      await watcher.start({
        onInteraction: stub(),
        paths: ['/test/path'],
      })
      await watcher.stop()

      expect(watcher.isWatching()).to.be.false
    })
  })

  describe('start', () => {
    it('should register file event handler', async () => {
      await watcher.start({
        onInteraction: stub(),
        paths: ['/test/path'],
      })

      expect(mockFileWatcher.setFileEventHandler.calledOnce).to.be.true
    })

    it('should start file watcher with provided paths', async () => {
      const paths = ['/path1', '/path2']
      await watcher.start({
        onInteraction: stub(),
        paths,
      })

      expect(mockFileWatcher.start.calledOnce).to.be.true
      expect(mockFileWatcher.start.calledWith(paths)).to.be.true
    })

    it('should throw error if already watching', async () => {
      await watcher.start({
        onInteraction: stub(),
        paths: ['/test/path'],
      })

      try {
        await watcher.start({
          onInteraction: stub(),
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
        onInteraction: stub(),
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
      const onInteraction = stub().resolves()
      const mockInteraction = createMockInteraction('/test/file.log')

      mockParser.parseLogFile.resolves([mockInteraction])

      await watcher.start({
        onInteraction,
        paths: ['/test/path'],
      })

      // Simulate file add event
      const fileEvent: FileEvent = {
        path: '/test/file.log',
        type: 'add',
      }
      await fileEventHandler?.(fileEvent)

      expect(mockParser.parseLogFile.calledOnce).to.be.true
      expect(mockParser.parseLogFile.calledWith('/test/file.log')).to.be.true
      expect(onInteraction.calledOnce).to.be.true
      expect(onInteraction.calledWith(mockInteraction)).to.be.true
    })

    it('should process change events for valid log files', async () => {
      const onInteraction = stub().resolves()
      const mockInteraction = createMockInteraction('/test/file.log')

      mockParser.parseLogFile.resolves([mockInteraction])

      await watcher.start({
        onInteraction,
        paths: ['/test/path'],
      })

      const fileEvent: FileEvent = {
        path: '/test/file.log',
        type: 'change',
      }
      await fileEventHandler?.(fileEvent)

      expect(onInteraction.calledOnce).to.be.true
    })

    it('should ignore unlink events', async () => {
      const onInteraction = stub().resolves()

      await watcher.start({
        onInteraction,
        paths: ['/test/path'],
      })

      const fileEvent: FileEvent = {
        path: '/test/file.log',
        type: 'unlink',
      }
      await fileEventHandler?.(fileEvent)

      expect(mockParser.parseLogFile.called).to.be.false
      expect(onInteraction.called).to.be.false
    })

    it('should ignore addDir events', async () => {
      const onInteraction = stub().resolves()

      await watcher.start({
        onInteraction,
        paths: ['/test/path'],
      })

      const fileEvent: FileEvent = {
        path: '/test/dir',
        type: 'addDir',
      }
      await fileEventHandler?.(fileEvent)

      expect(mockParser.parseLogFile.called).to.be.false
      expect(onInteraction.called).to.be.false
    })

    it('should skip invalid log files', async () => {
      const onInteraction = stub().resolves()

      mockParser.isValidLogFile.returns(false)

      await watcher.start({
        onInteraction,
        paths: ['/test/path'],
      })

      const fileEvent: FileEvent = {
        path: '/test/file.txt',
        type: 'add',
      }
      await fileEventHandler?.(fileEvent)

      expect(mockParser.parseLogFile.called).to.be.false
      expect(onInteraction.called).to.be.false
    })

    it('should invoke callback for each interaction from parser', async () => {
      const onInteraction = stub().resolves()
      const interactions = [
        createMockInteraction('/test/file.log'),
        createMockInteraction('/test/file.log'),
      ]

      mockParser.parseLogFile.resolves(interactions)

      await watcher.start({
        onInteraction,
        paths: ['/test/path'],
      })

      const fileEvent: FileEvent = {
        path: '/test/file.log',
        type: 'add',
      }
      await fileEventHandler?.(fileEvent)

      expect(onInteraction.callCount).to.equal(2)
      expect(onInteraction.firstCall.calledWith(interactions[0])).to.be.true
      expect(onInteraction.secondCall.calledWith(interactions[1])).to.be.true
    })
  })

  describe('error handling', () => {
    it('should handle parser errors gracefully', async () => {
      const onInteraction = stub().resolves()

      mockParser.parseLogFile.rejects(new Error('Parse error'))

      await watcher.start({
        onInteraction,
        paths: ['/test/path'],
      })

      const fileEvent: FileEvent = {
        path: '/test/file.log',
        type: 'add',
      }

      // Should not throw
      await fileEventHandler?.(fileEvent)

      expect(onInteraction.called).to.be.false
    })

    it('should handle callback errors gracefully', async () => {
      const onInteraction = stub().rejects(new Error('Callback error'))
      const mockInteraction = createMockInteraction('/test/file.log')

      mockParser.parseLogFile.resolves([mockInteraction])

      await watcher.start({
        onInteraction,
        paths: ['/test/path'],
      })

      const fileEvent: FileEvent = {
        path: '/test/file.log',
        type: 'add',
      }

      // Should not throw
      await fileEventHandler?.(fileEvent)

      expect(onInteraction.calledOnce).to.be.true
    })
  })

  describe('first watch behavior', () => {
    it('should process files on first watch', async () => {
      const onInteraction = stub().resolves()
      const mockInteraction = createMockInteraction('/test/file.log')

      mockParser.parseLogFile.resolves([mockInteraction])

      await watcher.start({
        onInteraction,
        paths: ['/test/path'],
      })

      const fileEvent: FileEvent = {
        path: '/test/file.log',
        type: 'add',
      }
      await fileEventHandler?.(fileEvent)

      expect(onInteraction.calledOnce).to.be.true
    })

    it('should skip already-processed files after first watch', async () => {
      const onInteraction = stub().resolves()
      const mockInteraction = createMockInteraction('/test/file.log')

      mockParser.parseLogFile.resolves([mockInteraction])

      // First watch
      await watcher.start({
        onInteraction,
        paths: ['/test/path'],
      })

      const fileEvent: FileEvent = {
        path: '/test/file.log',
        type: 'add',
      }
      await fileEventHandler?.(fileEvent)

      // Stop and restart (second watch)
      await watcher.stop()
      await watcher.start({
        onInteraction,
        paths: ['/test/path'],
      })

      // Same file event should be skipped on second watch
      await fileEventHandler?.(fileEvent)

      // Should only be called once (from first watch)
      expect(onInteraction.calledOnce).to.be.true
    })

    it('should process change events even for previously seen files', async () => {
      const onInteraction = stub().resolves()
      const mockInteraction = createMockInteraction('/test/file.log')

      mockParser.parseLogFile.resolves([mockInteraction])

      await watcher.start({
        onInteraction,
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
        onInteraction,
        paths: ['/test/path'],
      })

      // Second: change event for same file
      const changeEvent: FileEvent = {
        path: '/test/file.log',
        type: 'change',
      }
      await fileEventHandler?.(changeEvent)

      // Should be called twice (add + change)
      expect(onInteraction.calledTwice).to.be.true
    })
  })
})
