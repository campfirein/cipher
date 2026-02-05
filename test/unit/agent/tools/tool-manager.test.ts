import {expect} from 'chai'
import {createSandbox, restore, type SinonSandbox, type SinonStub} from 'sinon'

import type {ToolSet} from '../../../../src/agent/core/domain/tools/types.js'
import type {IToolProvider} from '../../../../src/agent/core/interfaces/i-tool-provider.js'
import type {IToolScheduler} from '../../../../src/agent/core/interfaces/i-tool-scheduler.js'

import {ToolError, ToolErrorType} from '../../../../src/agent/core/domain/tools/tool-error.js'
import {ToolManager} from '../../../../src/agent/infra/tools/tool-manager.js'
import {ToolMarker} from '../../../../src/agent/infra/tools/tool-markers.js'


describe('ToolManager', () => {
  let sandbox: SinonSandbox
  let mockToolProvider: IToolProvider
  let mockScheduler: IToolScheduler
  let toolManager: ToolManager

  // Tool names are snake_case by design, matching the actual tool registry
  const mockTools: ToolSet = {
    // eslint-disable-next-line camelcase
    bash_exec: {
      description: 'Execute bash command',
      parameters: {properties: {}, type: 'object'},
    },
    curate: {
      description: 'Curate knowledge',
      parameters: {properties: {}, type: 'object'},
    },
    // eslint-disable-next-line camelcase
    detect_domains: {
      description: 'Detect domains',
      parameters: {properties: {}, type: 'object'},
    },
    // eslint-disable-next-line camelcase
    glob_files: {
      description: 'Glob files',
      parameters: {properties: {}, type: 'object'},
    },
    // eslint-disable-next-line camelcase
    grep_content: {
      description: 'Grep content',
      parameters: {properties: {}, type: 'object'},
    },
    // eslint-disable-next-line camelcase
    list_directory: {
      description: 'List directory',
      parameters: {properties: {}, type: 'object'},
    },
    // eslint-disable-next-line camelcase
    read_file: {
      description: 'Read a file',
      parameters: {properties: {}, type: 'object'},
    },
  }

  beforeEach(() => {
    sandbox = createSandbox()

    mockToolProvider = {
      executeTool: sandbox.stub().resolves('tool result'),
      getAllTools: sandbox.stub().returns(mockTools),
      getAvailableMarkers: sandbox.stub().returns(new Set(['Core', 'Discovery'])),
      getToolCount: sandbox.stub().returns(7),
      getToolNames: sandbox.stub().returns(Object.keys(mockTools)),
      getToolsByMarker: sandbox.stub().returns(['read_file', 'grep_content']),
      hasTool: sandbox.stub().returns(true),
      initialize: sandbox.stub().resolves(),
    } as unknown as IToolProvider

    mockScheduler = {
      clearHistory: sandbox.stub(),
      execute: sandbox.stub().resolves('scheduled result'),
      getHistory: sandbox.stub().returns([]),
    } as unknown as IToolScheduler
  })

  afterEach(() => {
    sandbox.restore()
    restore()
  })

  describe('constructor', () => {
    it('should create ToolManager with tool provider', () => {
      toolManager = new ToolManager(mockToolProvider)

      expect(toolManager).to.be.instanceOf(ToolManager)
    })

    it('should create ToolManager with tool provider and scheduler', () => {
      toolManager = new ToolManager(mockToolProvider, mockScheduler)

      expect(toolManager).to.be.instanceOf(ToolManager)
    })
  })

  describe('executeTool', () => {
    beforeEach(() => {
      toolManager = new ToolManager(mockToolProvider)
    })

    describe('without scheduler', () => {
      it('should execute tool via provider', async () => {
        const result = await toolManager.executeTool('read_file', {path: '/test'}, 'session-1')

        expect((mockToolProvider.executeTool as SinonStub).calledOnce).to.be.true
        expect((mockToolProvider.executeTool as SinonStub).calledWith('read_file', {path: '/test'}, 'session-1')).to.be.true
        expect(result.success).to.be.true
        expect(result.content).to.equal('tool result')
      })

      it('should return error result when tool not found', async () => {
        ;(mockToolProvider.hasTool as SinonStub).returns(false)

        const result = await toolManager.executeTool('nonexistent_tool', {}, 'session-1')

        expect(result.success).to.be.false
        expect(result.errorType).to.equal(ToolErrorType.TOOL_NOT_FOUND)
        expect((mockToolProvider.executeTool as SinonStub).called).to.be.false
      })

      it('should return error result when provider throws', async () => {
        const error = new Error('Provider error')
        ;(mockToolProvider.executeTool as SinonStub).rejects(error)

        const result = await toolManager.executeTool('read_file', {}, 'session-1')

        expect(result.success).to.be.false
        expect(result.errorType).to.exist
        expect(result.errorMessage).to.exist
      })

      it('should include duration in result', async () => {
        const result = await toolManager.executeTool('read_file', {}, 'session-1')

        expect(result.metadata?.durationMs).to.be.a('number')
        expect(result.metadata?.durationMs).to.be.at.least(0)
      })

      it('should use default sessionId when not provided', async () => {
        await toolManager.executeTool('read_file', {})

        expect((mockToolProvider.executeTool as SinonStub).calledWith('read_file', {})).to.be.true
        expect((mockToolProvider.executeTool as SinonStub).args[0][2]).to.be.undefined
      })
    })

    describe('with scheduler', () => {
      beforeEach(() => {
        toolManager = new ToolManager(mockToolProvider, mockScheduler)
      })

      it('should execute tool via scheduler', async () => {
        const result = await toolManager.executeTool('read_file', {path: '/test'}, 'session-1')

        expect((mockScheduler.execute as SinonStub).calledOnce).to.be.true
        // Now passes taskId in context (undefined when not provided)
        expect(
          (mockScheduler.execute as SinonStub).calledWith('read_file', {path: '/test'}, {
            sessionId: 'session-1',
            taskId: undefined,
          }),
        ).to.be.true
        expect((mockToolProvider.executeTool as SinonStub).called).to.be.false
        expect(result.success).to.be.true
        expect(result.content).to.equal('scheduled result')
      })

      it('should use default sessionId when not provided', async () => {
        await toolManager.executeTool('read_file', {})

        // Now passes taskId in context (undefined when not provided)
        expect((mockScheduler.execute as SinonStub).calledWith('read_file', {}, {sessionId: 'default', taskId: undefined})).to.be.true
      })

      it('should return error result when scheduler throws', async () => {
        const error = new Error('Scheduler error')
        ;(mockScheduler.execute as SinonStub).rejects(error)

        const result = await toolManager.executeTool('read_file', {}, 'session-1')

        expect(result.success).to.be.false
        expect(result.errorType).to.exist
      })
    })
  })

  describe('getAllTools', () => {
    beforeEach(() => {
      toolManager = new ToolManager(mockToolProvider)
    })

    it('should return all tools from provider', () => {
      const tools = toolManager.getAllTools()

      expect(tools).to.deep.equal(mockTools)
      expect((mockToolProvider.getAllTools as SinonStub).calledOnce).to.be.true
    })

    it('should cache tools on subsequent calls', () => {
      toolManager.getAllTools()
      toolManager.getAllTools()
      toolManager.getAllTools()

      expect((mockToolProvider.getAllTools as SinonStub).calledOnce).to.be.true
    })

    it('should rebuild cache after refresh', () => {
      toolManager.getAllTools()
      toolManager.refresh()
      toolManager.getAllTools()

      expect((mockToolProvider.getAllTools as SinonStub).calledTwice).to.be.true
    })

    it('should rebuild cache after initialize', async () => {
      toolManager.getAllTools()
      await toolManager.initialize()
      toolManager.getAllTools()

      expect((mockToolProvider.getAllTools as SinonStub).calledTwice).to.be.true
    })
  })

  describe('getToolNamesForCommand', () => {
    beforeEach(() => {
      toolManager = new ToolManager(mockToolProvider)
      ;(mockToolProvider.hasTool as SinonStub).callsFake((name: string) => Object.keys(mockTools).includes(name))
    })

    it('should return query tools for query command', () => {
      // Add code_exec to mock tools for this test
      const mockToolsWithCodeExec = {
        ...mockTools,
        // eslint-disable-next-line camelcase
        code_exec: {
          description: 'Execute code in sandbox',
          parameters: {properties: {}, type: 'object'},
        },
      }
      ;(mockToolProvider.getAllTools as SinonStub).returns(mockToolsWithCodeExec)
      ;(mockToolProvider.hasTool as SinonStub).callsFake((name: string) => Object.keys(mockToolsWithCodeExec).includes(name))
      toolManager.refresh()

      const names = toolManager.getToolNamesForCommand('query')

      // Query only uses code_exec for programmatic search
      expect(names).to.deep.equal(['code_exec'])
      expect(names).to.not.include('read_file')
      expect(names).to.not.include('grep_content')
      expect(names).to.not.include('glob_files')
      expect(names).to.not.include('curate')
      expect(names).to.not.include('detect_domains')
      expect(names).to.not.include('bash_exec')
    })

    it('should return curate tools for curate command', () => {
      // Add code_exec to mock tools for this test
      const mockToolsWithCodeExec = {
        ...mockTools,
        // eslint-disable-next-line camelcase
        code_exec: {
          description: 'Execute code in sandbox',
          parameters: {properties: {}, type: 'object'},
        },
      }
      ;(mockToolProvider.getAllTools as SinonStub).returns(mockToolsWithCodeExec)
      ;(mockToolProvider.hasTool as SinonStub).callsFake((name: string) => Object.keys(mockToolsWithCodeExec).includes(name))
      toolManager.refresh()

      const names = toolManager.getToolNamesForCommand('curate')

      // Curate now only uses code_exec (curate operations available via tools.curate() in sandbox)
      expect(names).to.deep.equal(['code_exec'])
      expect(names).to.not.include('detect_domains')
      expect(names).to.not.include('read_file')
      expect(names).to.not.include('grep_content')
      expect(names).to.not.include('glob_files')
      expect(names).to.not.include('curate')
      expect(names).to.not.include('bash_exec')
    })

    it('should return all tools for other commands', () => {
      const names = toolManager.getToolNamesForCommand('other')

      expect(names).to.deep.equal(Object.keys(mockTools))
    })

    it('should return all tools when commandType is undefined', () => {
      const names = toolManager.getToolNamesForCommand()

      expect(names).to.deep.equal(Object.keys(mockTools))
    })

    it('should filter out tools that do not exist', () => {
      // Add code_exec to mock tools for this test
      const mockToolsWithCodeExec = {
        ...mockTools,
        // eslint-disable-next-line camelcase
        code_exec: {
          description: 'Execute code in sandbox',
          parameters: {properties: {}, type: 'object'},
        },
      }
      ;(mockToolProvider.getAllTools as SinonStub).returns(mockToolsWithCodeExec)
      // Filter out code_exec to test filtering behavior
      ;(mockToolProvider.hasTool as SinonStub).callsFake((name: string) => name !== 'code_exec')
      toolManager.refresh()

      const names = toolManager.getToolNamesForCommand('curate')

      // Curate only uses code_exec, which we filtered out
      expect(names).to.deep.equal([])
    })
  })

  describe('getToolsForCommand', () => {
    beforeEach(() => {
      toolManager = new ToolManager(mockToolProvider)
    })

    it('should return query tools for query command', () => {
      // Add code_exec to mock tools for this test
      const mockToolsWithCodeExec = {
        ...mockTools,
        // eslint-disable-next-line camelcase
        code_exec: {
          description: 'Execute code in sandbox',
          parameters: {properties: {}, type: 'object'},
        },
      }
      ;(mockToolProvider.getAllTools as SinonStub).returns(mockToolsWithCodeExec)
      toolManager.refresh()

      const tools = toolManager.getToolsForCommand('query')

      // Query only uses code_exec for programmatic search
      expect(tools).to.have.property('code_exec')
      expect(Object.keys(tools)).to.have.length(1)
      expect(tools).to.not.have.property('read_file')
      expect(tools).to.not.have.property('grep_content')
      expect(tools).to.not.have.property('glob_files')
      expect(tools).to.not.have.property('curate')
      expect(tools).to.not.have.property('detect_domains')
      expect(tools).to.not.have.property('bash_exec')
    })

    it('should return curate tools for curate command', () => {
      // Add code_exec to mock tools for this test
      const mockToolsWithCodeExec = {
        ...mockTools,
        // eslint-disable-next-line camelcase
        code_exec: {
          description: 'Execute code in sandbox',
          parameters: {properties: {}, type: 'object'},
        },
      }
      ;(mockToolProvider.getAllTools as SinonStub).returns(mockToolsWithCodeExec)
      toolManager.refresh()

      const tools = toolManager.getToolsForCommand('curate')

      // Curate now only uses code_exec (curate operations available via tools.curate() in sandbox)
      expect(tools).to.have.property('code_exec')
      expect(Object.keys(tools)).to.have.length(1)
      expect(tools).to.not.have.property('detect_domains')
      expect(tools).to.not.have.property('read_file')
      expect(tools).to.not.have.property('grep_content')
      expect(tools).to.not.have.property('glob_files')
      expect(tools).to.not.have.property('curate')
      expect(tools).to.not.have.property('bash_exec')
    })

    it('should return all tools for other commands', () => {
      const tools = toolManager.getToolsForCommand('other')

      expect(tools).to.deep.equal(mockTools)
    })

    it('should return all tools when commandType is undefined', () => {
      const tools = toolManager.getToolsForCommand()

      expect(tools).to.deep.equal(mockTools)
    })

    it('should only include tools that exist in allTools', () => {
      // Curate now only uses code_exec, so test with limited tools that don't include code_exec
      const limitedTools: ToolSet = {
        // eslint-disable-next-line camelcase
        glob_files: mockTools.glob_files!,
        // eslint-disable-next-line camelcase
        read_file: mockTools.read_file!,
      }
      ;(mockToolProvider.getAllTools as SinonStub).returns(limitedTools)
      toolManager.refresh()

      const tools = toolManager.getToolsForCommand('curate')

      // Curate only uses code_exec, which is not in allTools, so empty result
      expect(Object.keys(tools)).to.have.length(0)
    })
  })

  describe('getAvailableMarkers', () => {
    beforeEach(() => {
      toolManager = new ToolManager(mockToolProvider)
    })

    it('should return markers from provider', () => {
      const markers = toolManager.getAvailableMarkers()

      expect(markers).to.be.instanceOf(Set)
      expect(markers.has('Core')).to.be.true
      expect(markers.has('Discovery')).to.be.true
    })
  })

  describe('getToolCount', () => {
    beforeEach(() => {
      toolManager = new ToolManager(mockToolProvider)
    })

    it('should return tool count from provider', () => {
      const count = toolManager.getToolCount()

      expect(count).to.equal(7)
      expect((mockToolProvider.getToolCount as SinonStub).calledOnce).to.be.true
    })
  })

  describe('getToolNames', () => {
    beforeEach(() => {
      toolManager = new ToolManager(mockToolProvider)
    })

    it('should return tool names from provider', () => {
      const names = toolManager.getToolNames()

      expect(names).to.deep.equal(Object.keys(mockTools))
      expect((mockToolProvider.getToolNames as SinonStub).calledOnce).to.be.true
    })
  })

  describe('getToolsByMarker', () => {
    beforeEach(() => {
      toolManager = new ToolManager(mockToolProvider)
    })

    it('should return tools by marker from provider', () => {
      const tools = toolManager.getToolsByMarker(ToolMarker.Core)

      expect(tools).to.deep.equal(['read_file', 'grep_content'])
      expect((mockToolProvider.getToolsByMarker as SinonStub).calledOnce).to.be.true
      expect((mockToolProvider.getToolsByMarker as SinonStub).calledWith(ToolMarker.Core)).to.be.true
    })
  })

  describe('hasTool', () => {
    beforeEach(() => {
      toolManager = new ToolManager(mockToolProvider)
    })

    it('should return true when tool exists', () => {
      const exists = toolManager.hasTool('read_file')

      expect(exists).to.be.true
      expect((mockToolProvider.hasTool as SinonStub).calledOnce).to.be.true
      expect((mockToolProvider.hasTool as SinonStub).calledWith('read_file')).to.be.true
    })

    it('should return false when tool does not exist', () => {
      ;(mockToolProvider.hasTool as SinonStub).returns(false)

      const exists = toolManager.hasTool('nonexistent')

      expect(exists).to.be.false
    })
  })

  describe('initialize', () => {
    beforeEach(() => {
      toolManager = new ToolManager(mockToolProvider)
    })

    it('should initialize provider and invalidate cache', async () => {
      await toolManager.initialize()

      expect((mockToolProvider.initialize as SinonStub).calledOnce).to.be.true
      // Cache should be invalidated, so next getAllTools should call provider
      toolManager.getAllTools()
      expect((mockToolProvider.getAllTools as SinonStub).called).to.be.true
    })
  })

  describe('refresh', () => {
    beforeEach(() => {
      toolManager = new ToolManager(mockToolProvider)
    })

    it('should invalidate cache', () => {
      toolManager.getAllTools()
      toolManager.refresh()
      toolManager.getAllTools()

      expect((mockToolProvider.getAllTools as SinonStub).calledTwice).to.be.true
    })
  })

  describe('error handling', () => {
    beforeEach(() => {
      toolManager = new ToolManager(mockToolProvider)
    })

    it('should handle ToolError correctly', async () => {
      const toolError = new ToolError('Custom error', ToolErrorType.EXECUTION_FAILED, 'read_file')
      ;(mockToolProvider.executeTool as SinonStub).rejects(toolError)

      const result = await toolManager.executeTool('read_file', {}, 'session-1')

      expect(result.success).to.be.false
      expect(result.errorType).to.equal(ToolErrorType.EXECUTION_FAILED)
    })

    it('should include available tools in error context when tool not found', async () => {
      ;(mockToolProvider.hasTool as SinonStub).returns(false)
      ;(mockToolProvider.getToolNames as SinonStub).returns(['tool1', 'tool2'])

      const result = await toolManager.executeTool('nonexistent', {}, 'session-1')

      expect(result.success).to.be.false
      expect(result.errorType).to.equal(ToolErrorType.TOOL_NOT_FOUND)
    })
  })
})
