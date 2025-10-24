import {Config} from '@oclif/core'
import {expect} from 'chai'
import sinon from 'sinon'

import Apply from '../../../src/commands/ace/apply.js'
import {ApplyDeltaUseCase} from '../../../src/core/usecases/apply-delta-use-case.js'

describe('ace:apply command', () => {
  let sandbox: sinon.SinonSandbox
  let config: Config

  beforeEach(async () => {
    sandbox = sinon.createSandbox()
    config = await Config.load()
  })

  afterEach(() => {
    sandbox.restore()
  })

  it('should apply delta operations from file successfully', async () => {
    const deltaJson = {
      operations: [
        {
          bulletId: 'test-00001',
          content: 'Test content',
          metadata: {
            codebasePath: '/src',
            tags: ['test'],
            timestamp: '2025-10-24T00:00:00.000Z',
          },
          section: 'Test Section',
          type: 'ADD',
        },
      ],
      reasoning: 'Test delta batch',
    }

    const command = new Apply(['delta.json'], config)

    // Stub file read method
    sandbox.stub(command as unknown as {readDeltaFile: (path: string) => Promise<string>}, 'readDeltaFile').resolves(JSON.stringify(deltaJson))

    // Stub use case
    sandbox.stub(ApplyDeltaUseCase.prototype, 'execute').resolves({
      operationsApplied: 1,
      success: true,
    })

    const logSpy = sandbox.spy(command, 'log')

    await command.run()

    // Verify success message
    expect(logSpy.calledWith(sinon.match(/Successfully applied 1 operation/))).to.be.true
    expect(logSpy.calledWith(sinon.match(/Test delta batch/))).to.be.true
  })

  it('should display operation breakdown by type', async () => {
    const deltaJson = {
      operations: [
        {
          bulletId: 'test-00001',
          content: 'Test 1',
          metadata: {
            codebasePath: '/src',
            tags: ['test'],
            timestamp: '2025-10-24T00:00:00.000Z',
          },
          section: 'Section',
          type: 'ADD',
        },
        {
          bulletId: 'test-00002',
          content: 'Test 2',
          metadata: {
            codebasePath: '/src',
            tags: ['test'],
            timestamp: '2025-10-24T00:00:00.000Z',
          },
          section: 'Section',
          type: 'ADD',
        },
        {
          bulletId: 'test-00001',
          section: 'Section',
          type: 'REMOVE',
        },
      ],
      reasoning: 'Mixed operations',
    }

    const command = new Apply(['delta.json'], config)
    sandbox.stub(command as unknown as {readDeltaFile: (path: string) => Promise<string>}, 'readDeltaFile').resolves(JSON.stringify(deltaJson))
    sandbox.stub(ApplyDeltaUseCase.prototype, 'execute').resolves({
      operationsApplied: 3,
      success: true,
    })

    const logSpy = sandbox.spy(command, 'log')

    await command.run()

    // Verify operation breakdown
    expect(logSpy.calledWith(sinon.match(/ADD: 2/))).to.be.true
    expect(logSpy.calledWith(sinon.match(/REMOVE: 1/))).to.be.true
  })

  it('should handle empty delta batch', async () => {
    const deltaJson = {
      operations: [],
      reasoning: 'Empty batch',
    }

    const command = new Apply(['delta.json'], config)
    sandbox.stub(command as unknown as {readDeltaFile: (path: string) => Promise<string>}, 'readDeltaFile').resolves(JSON.stringify(deltaJson))

    const logSpy = sandbox.spy(command, 'log')

    await command.run()

    // Verify empty message
    expect(logSpy.calledWith('No operations to apply (empty delta batch).')).to.be.true
  })

  it('should handle file not found error', async () => {
    const command = new Apply(['nonexistent.json'], config)
    sandbox.stub(command as unknown as {readDeltaFile: (path: string) => Promise<string>}, 'readDeltaFile').rejects(new Error('ENOENT: no such file'))

    try {
      await command.run()
      expect.fail('Should have thrown error')
    } catch (error) {
      expect(error).to.be.an('error')
      expect((error as Error).message).to.include('Delta file not found')
    }
  })

  it('should handle invalid JSON error', async () => {
    const command = new Apply(['delta.json'], config)
    sandbox.stub(command as unknown as {readDeltaFile: (path: string) => Promise<string>}, 'readDeltaFile').resolves('invalid json{')

    try {
      await command.run()
      expect.fail('Should have thrown error')
    } catch (error) {
      expect(error).to.be.an('error')
      expect((error as Error).message).to.include('Invalid JSON')
    }
  })

  it('should handle use case errors', async () => {
    const deltaJson = {
      operations: [
        {
          bulletId: 'test-00001',
          content: 'Test',
          metadata: {
            codebasePath: '/src',
            tags: ['test'],
            timestamp: '2025-10-24T00:00:00.000Z',
          },
          section: 'Section',
          type: 'ADD',
        },
      ],
      reasoning: 'Test',
    }

    const command = new Apply(['delta.json'], config)
    sandbox.stub(command as unknown as {readDeltaFile: (path: string) => Promise<string>}, 'readDeltaFile').resolves(JSON.stringify(deltaJson))
    sandbox.stub(ApplyDeltaUseCase.prototype, 'execute').resolves({
      error: 'Failed to save playbook',
      success: false,
    })

    try {
      await command.run()
      expect.fail('Should have thrown error')
    } catch (error) {
      expect(error).to.be.an('error')
      expect((error as Error).message).to.include('Failed to save playbook')
    }
  })

  it('should accept custom directory parameter', async () => {
    const deltaJson = {
      operations: [
        {
          bulletId: 'test-00001',
          content: 'Test',
          metadata: {
            codebasePath: '/src',
            tags: ['test'],
            timestamp: '2025-10-24T00:00:00.000Z',
          },
          section: 'Section',
          type: 'ADD',
        },
      ],
      reasoning: 'Test',
    }

    const command = new Apply(['delta.json', '/custom/path'], config)
    sandbox.stub(command as unknown as {readDeltaFile: (path: string) => Promise<string>}, 'readDeltaFile').resolves(JSON.stringify(deltaJson))
    const executeStub = sandbox.stub(ApplyDeltaUseCase.prototype, 'execute').resolves({
      operationsApplied: 1,
      success: true,
    })

    await command.run()

    // Verify custom directory was passed
    expect(executeStub.firstCall.args[1]).to.equal('/custom/path')
  })

  it('should handle invalid delta batch format', async () => {
    const invalidJson = {
      operations: [],
      reasoning: '', // Empty reasoning should fail validation
    }

    const command = new Apply(['delta.json'], config)
    sandbox.stub(command as unknown as {readDeltaFile: (path: string) => Promise<string>}, 'readDeltaFile').resolves(JSON.stringify(invalidJson))

    try {
      await command.run()
      expect.fail('Should have thrown error')
    } catch (error) {
      expect(error).to.be.an('error')
      expect((error as Error).message).to.include('reasoning cannot be empty')
    }
  })
})
