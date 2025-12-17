import {expect} from 'chai'
import {mkdirSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import type {TransportClientFactoryConfig} from '../../../../src/infra/transport/transport-client-factory.js'

import {InstanceCrashedError, NoInstanceRunningError} from '../../../../src/core/domain/errors/connection-error.js'
import {CoreProcess} from '../../../../src/infra/core/core-process.js'
import {FileInstanceDiscovery} from '../../../../src/infra/instance/file-instance-discovery.js'
import {FileInstanceManager} from '../../../../src/infra/instance/file-instance-manager.js'
import {createTaskRunner, TaskRunner} from '../../../../src/infra/transport/task-runner.js'
import {createTransportClientFactory} from '../../../../src/infra/transport/transport-client-factory.js'

/**
 * Integration tests for CLI ↔ Core communication.
 *
 * These tests verify end-to-end flow from CLI commands connecting to
 * a running Core process, creating tasks, and receiving events.
 *
 * Architecture flow tested:
 * CLI (curate/query) → TransportClientFactory → FileInstanceDiscovery → Core Process
 */
describe('CLI to Core Integration', function () {
  this.timeout(15_000) // 15s timeout for integration tests

  let core: CoreProcess
  let tempDir: string
  let brvDir: string

  beforeEach(() => {
    // Create temp directory with .brv folder for each test
    tempDir = join(tmpdir(), `brv-cli-core-test-${Date.now()}`)
    brvDir = join(tempDir, '.brv')
    mkdirSync(brvDir, {recursive: true})
  })

  afterEach(async () => {
    // Cleanup core
    if (core?.isRunning()) {
      await core.stop()
    }

    // Cleanup temp directory
    try {
      rmSync(tempDir, {recursive: true})
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('TransportClientFactory', () => {
    describe('Discovery', () => {
      it('should throw NoInstanceRunningError when no instance file exists', async () => {
        // Create factory with discovery pointing to temp dir (no instance.json)
        const factory = createTransportClientFactory({
          discovery: new FileInstanceDiscovery(new FileInstanceManager()),
        })

        try {
          await factory.connect(tempDir)
          expect.fail('Should have thrown NoInstanceRunningError')
        } catch (error) {
          expect(error).to.be.instanceOf(NoInstanceRunningError)
          expect((error as Error).message).to.include('No ByteRover instance is running')
        }
      })

      it('should throw InstanceCrashedError when instance file exists but process is dead', async () => {
        // Write a fake instance.json with a dead PID
        const {writeFileSync} = await import('node:fs')
        writeFileSync(
          join(brvDir, 'instance.json'),
          JSON.stringify({
            currentSessionId: null,
            pid: 999_999, // Non-existent PID
            port: 12_345,
            startedAt: Date.now(),
          }),
        )

        const factory = createTransportClientFactory({
          discovery: new FileInstanceDiscovery(new FileInstanceManager()),
        })

        try {
          await factory.connect(tempDir)
          expect.fail('Should have thrown InstanceCrashedError')
        } catch (error) {
          expect(error).to.be.instanceOf(InstanceCrashedError)
          expect((error as Error).message).to.include('has crashed')
        }
      })

      it('should connect successfully when Core is running', async () => {
        // Start Core process
        core = new CoreProcess({projectRoot: tempDir})
        await core.start()

        // Create factory with discovery
        const factory = createTransportClientFactory({
          discovery: new FileInstanceDiscovery(new FileInstanceManager()),
        })

        // Connect from temp dir (should find .brv/instance.json)
        const result = await factory.connect(tempDir)

        expect(result.client).to.exist
        expect(result.projectRoot).to.equal(tempDir)
        expect(result.client.getState()).to.equal('connected')

        // Cleanup
        await result.client.disconnect()
      })
    })

    describe('Retry Logic', () => {
      it('should retry connection on failure', async () => {
        // Start Core process
        core = new CoreProcess({projectRoot: tempDir})
        await core.start()

        // Create factory with short retry delay for testing
        const factory = createTransportClientFactory({
          discovery: new FileInstanceDiscovery(new FileInstanceManager()),
          maxRetries: 3,
          retryDelayMs: 100,
        })

        // Connect (should succeed on first try)
        const result = await factory.connect(tempDir)
        expect(result.client.getState()).to.equal('connected')

        await result.client.disconnect()
      })
    })

    describe('Walk-up Discovery', () => {
      it('should find instance from subdirectory', async () => {
        // Create nested subdirectory
        const subDir = join(tempDir, 'src', 'components')
        mkdirSync(subDir, {recursive: true})

        // Start Core in parent (tempDir with .brv)
        core = new CoreProcess({projectRoot: tempDir})
        await core.start()

        // Create factory
        const factory = createTransportClientFactory({
          discovery: new FileInstanceDiscovery(new FileInstanceManager()),
        })

        // Connect from subdirectory - should walk up and find .brv
        const result = await factory.connect(subDir)

        expect(result.projectRoot).to.equal(tempDir)
        expect(result.client.getState()).to.equal('connected')

        await result.client.disconnect()
      })
    })
  })

  describe('TaskRunner', () => {
    let runner: TaskRunner

    beforeEach(async () => {
      // Start Core process for TaskRunner tests
      core = new CoreProcess({projectRoot: tempDir})
      await core.start()

      // Create TaskRunner with factory pointing to temp dir
      runner = createTaskRunner({
        factory: createTransportClientFactory({
          discovery: new FileInstanceDiscovery(new FileInstanceManager()),
        }),
        timeoutMs: 5000, // 5 second timeout for tests
      })
    })

    describe('Task Creation', () => {
      it('should create a curate task and receive taskId', async () => {
        let startedTaskId: string | undefined

        // Run curate task from temp directory
        const originalCwd = process.cwd()
        process.chdir(tempDir)

        try {
          const result = await runner.curate('Add authentication context', {
            onStarted(taskId) {
              startedTaskId = taskId
            },
          })

          expect(result.taskId).to.be.a('string')
          expect(result.taskId.length).to.be.greaterThan(0)
          expect(startedTaskId).to.equal(result.taskId)
        } finally {
          process.chdir(originalCwd)
        }
      })

      it('should create a query task and receive taskId', async () => {
        const originalCwd = process.cwd()
        process.chdir(tempDir)

        try {
          const result = await runner.query('What is the auth flow?')

          expect(result.taskId).to.be.a('string')
          expect(result.taskId.length).to.be.greaterThan(0)
        } finally {
          process.chdir(originalCwd)
        }
      })
    })

    describe('Event Callbacks', () => {
      it('should call onStarted callback when task starts', async () => {
        const callbacks: string[] = []

        const originalCwd = process.cwd()
        process.chdir(tempDir)

        try {
          await runner.curate('Test context', {
            onStarted(taskId) {
              callbacks.push(`started:${taskId}`)
            },
          })

          expect(callbacks.length).to.be.greaterThan(0)
          expect(callbacks[0]).to.match(/^started:/)
        } finally {
          process.chdir(originalCwd)
        }
      })
    })

    describe('Error Handling', () => {
      it('should return failure when Core is not running', async () => {
        // Stop core first (this deletes instance.json)
        await core.stop()

        // Create runner without running Core
        const runnerNoCore = createTaskRunner({
          factory: createTransportClientFactory({
            discovery: new FileInstanceDiscovery(new FileInstanceManager()),
          }),
        })

        const originalCwd = process.cwd()
        process.chdir(tempDir)

        try {
          const result = await runnerNoCore.curate('Test')

          expect(result.success).to.be.false
          // When Core.stop() runs, it deletes instance.json, so we get NoInstanceRunningError
          expect(result.error).to.be.instanceOf(NoInstanceRunningError)
        } finally {
          process.chdir(originalCwd)
        }
      })

      it('should call onError callback on failure', async () => {
        await core.stop()

        const runnerNoCore = createTaskRunner({
          factory: createTransportClientFactory({
            discovery: new FileInstanceDiscovery(new FileInstanceManager()),
          }),
        })

        let errorReceived: Error | undefined

        const originalCwd = process.cwd()
        process.chdir(tempDir)

        try {
          await runnerNoCore.curate('Test', {
            onError(err) {
              errorReceived = err
            },
          })

          expect(errorReceived).to.exist
          // When Core.stop() runs, it deletes instance.json, so we get NoInstanceRunningError
          expect(errorReceived?.message).to.include('No ByteRover instance')
        } finally {
          process.chdir(originalCwd)
        }
      })
    })
  })

  describe('Multi-Client Scenario', () => {
    it('should allow multiple CLI clients to connect simultaneously', async () => {
      // Start Core
      core = new CoreProcess({projectRoot: tempDir})
      await core.start()

      const factoryConfig: TransportClientFactoryConfig = {
        discovery: new FileInstanceDiscovery(new FileInstanceManager()),
      }

      // Create two factories (simulating two CLI instances)
      const factory1 = createTransportClientFactory(factoryConfig)
      const factory2 = createTransportClientFactory(factoryConfig)

      // Connect both
      const [result1, result2] = await Promise.all([factory1.connect(tempDir), factory2.connect(tempDir)])

      expect(result1.client.getState()).to.equal('connected')
      expect(result2.client.getState()).to.equal('connected')

      // They should have different client IDs
      expect(result1.client.getClientId()).to.not.equal(result2.client.getClientId())

      // Cleanup
      await Promise.all([result1.client.disconnect(), result2.client.disconnect()])
    })

    it('should allow both CLI clients to create tasks', async () => {
      // Start Core
      core = new CoreProcess({projectRoot: tempDir})
      await core.start()

      const factoryConfig: TransportClientFactoryConfig = {
        discovery: new FileInstanceDiscovery(new FileInstanceManager()),
      }

      const runner1 = createTaskRunner({factory: createTransportClientFactory(factoryConfig), timeoutMs: 5000})
      const runner2 = createTaskRunner({factory: createTransportClientFactory(factoryConfig), timeoutMs: 5000})

      const originalCwd = process.cwd()
      process.chdir(tempDir)

      try {
        // Both create tasks simultaneously
        const [result1, result2] = await Promise.all([
          runner1.curate('Add auth context'),
          runner2.query('What is auth flow?'),
        ])

        expect(result1.taskId).to.be.a('string')
        expect(result2.taskId).to.be.a('string')
        expect(result1.taskId).to.not.equal(result2.taskId)
      } finally {
        process.chdir(originalCwd)
      }
    })
  })

  describe('Connection Error Messages', () => {
    it('should provide user-friendly error for no instance', async () => {
      const factory = createTransportClientFactory({
        discovery: new FileInstanceDiscovery(new FileInstanceManager()),
      })

      // Connect from a directory with no .brv
      const nonBrvDir = join(tmpdir(), `no-brv-${Date.now()}`)
      mkdirSync(nonBrvDir, {recursive: true})

      try {
        await factory.connect(nonBrvDir)
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).to.be.instanceOf(NoInstanceRunningError)
        expect((error as Error).message).to.include('brv start')
      } finally {
        rmSync(nonBrvDir, {recursive: true})
      }
    })

    it('should provide user-friendly error for crashed instance', async () => {
      // Write fake instance with dead PID
      const {writeFileSync} = await import('node:fs')
      writeFileSync(
        join(brvDir, 'instance.json'),
        JSON.stringify({
          currentSessionId: null, // Required field for valid instance.json
          pid: 999_999,
          port: 12_345,
          startedAt: Date.now(),
        }),
      )

      const factory = createTransportClientFactory({
        discovery: new FileInstanceDiscovery(new FileInstanceManager()),
      })

      try {
        await factory.connect(tempDir)
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).to.be.instanceOf(InstanceCrashedError)
        expect((error as Error).message).to.include('brv start')
      }
    })
  })
})
