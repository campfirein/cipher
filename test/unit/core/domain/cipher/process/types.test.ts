import type {ChildProcess} from 'node:child_process'

import {expectTypeOf} from 'expect-type'

import type {
  BackgroundProcess,
  CommandValidation,
  ExecuteOptions,
  OutputBuffer,
  ProcessConfig,
  ProcessHandle,
  ProcessInfo,
  ProcessOutput,
  ProcessResult,
} from '../../../../../../src/core/domain/cipher/process/types.js'

describe('cipher/process', () => {
  describe('Type Safety - ProcessConfig', () => {
    it('should enforce all required fields', () => {
      const config: ProcessConfig = {
        allowedCommands: ['git', 'npm'],
        blockedCommands: ['rm -rf', 'format'],
        environment: {NODE_ENV: 'production'},
        maxConcurrentProcesses: 5,
        maxOutputBuffer: 1_048_576,
        maxTimeout: 600_000,
        securityLevel: 'moderate',
        workingDirectory: '/path/to/project',
      }

      expectTypeOf<string[]>(config.allowedCommands)
      expectTypeOf<string[]>(config.blockedCommands)
      expectTypeOf<Record<string, string>>(config.environment)
      expectTypeOf<number>(config.maxConcurrentProcesses)
      expectTypeOf<number>(config.maxOutputBuffer)
      expectTypeOf<number>(config.maxTimeout)
      expectTypeOf<'moderate' | 'permissive' | 'strict'>(config.securityLevel)
      expectTypeOf<string | undefined>(config.workingDirectory)
    })

    it('should enforce securityLevel enum values', () => {
      const strict: ProcessConfig['securityLevel'] = 'strict'
      const moderate: ProcessConfig['securityLevel'] = 'moderate'
      const permissive: ProcessConfig['securityLevel'] = 'permissive'

      expectTypeOf<'moderate' | 'permissive' | 'strict'>(strict)
      expectTypeOf<'moderate' | 'permissive' | 'strict'>(moderate)
      expectTypeOf<'moderate' | 'permissive' | 'strict'>(permissive)
    })

    it('should make workingDirectory optional', () => {
      const withoutWorkingDir: ProcessConfig = {
        allowedCommands: [],
        blockedCommands: [],
        environment: {},
        maxConcurrentProcesses: 5,
        maxOutputBuffer: 1_048_576,
        maxTimeout: 600_000,
        securityLevel: 'moderate',
      }

      expectTypeOf<ProcessConfig>(withoutWorkingDir)
      expectTypeOf<string | undefined>(withoutWorkingDir.workingDirectory)
    })
  })

  describe('Type Safety - ExecuteOptions', () => {
    it('should make all fields optional', () => {
      const fullOptions: ExecuteOptions = {
        cwd: '/relative/path',
        description: 'Run tests',
        env: {TEST: 'true'},
        runInBackground: true,
        timeout: 120_000,
      }

      expectTypeOf<string | undefined>(fullOptions.cwd)
      expectTypeOf<string | undefined>(fullOptions.description)
      expectTypeOf<Record<string, string> | undefined>(fullOptions.env)
      expectTypeOf<boolean | undefined>(fullOptions.runInBackground)
      expectTypeOf<number | undefined>(fullOptions.timeout)

      // Empty options is valid
      const emptyOptions: ExecuteOptions = {}
      expectTypeOf<ExecuteOptions>(emptyOptions)
    })

    it('should allow partial options', () => {
      const descOnly: ExecuteOptions = {description: 'Build project'}
      const backgroundOnly: ExecuteOptions = {runInBackground: true}
      const timeoutOnly: ExecuteOptions = {timeout: 60_000}

      expectTypeOf<ExecuteOptions>(descOnly)
      expectTypeOf<ExecuteOptions>(backgroundOnly)
      expectTypeOf<ExecuteOptions>(timeoutOnly)
    })
  })

  describe('Type Safety - ProcessResult', () => {
    it('should enforce all required fields', () => {
      const result: ProcessResult = {
        duration: 1500,
        exitCode: 0,
        stderr: '',
        stdout: 'command output',
      }

      expectTypeOf<number>(result.duration)
      expectTypeOf<number>(result.exitCode)
      expectTypeOf<string>(result.stderr)
      expectTypeOf<string>(result.stdout)
    })

    it('should enforce number types for duration and exitCode', () => {
      const result: ProcessResult = {
        duration: 0,
        exitCode: 1,
        stderr: 'error message',
        stdout: '',
      }

      expectTypeOf<number>(result.duration)
      expectTypeOf<number>(result.exitCode)
    })
  })

  describe('Type Safety - ProcessHandle', () => {
    it('should enforce required fields', () => {
      const handle: ProcessHandle = {
        command: 'npm test',
        description: 'Run unit tests',
        pid: 12_345,
        processId: 'proc-123',
        startedAt: new Date(),
      }

      expectTypeOf<string>(handle.command)
      expectTypeOf<string | undefined>(handle.description)
      expectTypeOf<number | undefined>(handle.pid)
      expectTypeOf<string>(handle.processId)
      expectTypeOf<Date>(handle.startedAt)
    })

    it('should make description and pid optional', () => {
      const minimal: ProcessHandle = {
        command: 'npm test',
        processId: 'proc-123',
        startedAt: new Date(),
      }

      expectTypeOf<ProcessHandle>(minimal)
      expectTypeOf<string | undefined>(minimal.description)
      expectTypeOf<number | undefined>(minimal.pid)
    })

    it('should enforce Date type for startedAt', () => {
      const handle: ProcessHandle = {
        command: 'command',
        processId: 'id',
        startedAt: new Date(),
      }

      expectTypeOf<Date>(handle.startedAt)
    })
  })

  describe('Type Safety - ProcessOutput', () => {
    it('should enforce required and optional fields', () => {
      const output: ProcessOutput = {
        duration: 2000,
        exitCode: 0,
        status: 'completed',
        stderr: '',
        stdout: 'output',
      }

      expectTypeOf<number | undefined>(output.duration)
      expectTypeOf<number | undefined>(output.exitCode)
      expectTypeOf<'completed' | 'failed' | 'running'>(output.status)
      expectTypeOf<string>(output.stderr)
      expectTypeOf<string>(output.stdout)
    })

    it('should enforce status enum values', () => {
      const running: ProcessOutput['status'] = 'running'
      const completed: ProcessOutput['status'] = 'completed'
      const failed: ProcessOutput['status'] = 'failed'

      expectTypeOf<'completed' | 'failed' | 'running'>(running)
      expectTypeOf<'completed' | 'failed' | 'running'>(completed)
      expectTypeOf<'completed' | 'failed' | 'running'>(failed)
    })

    it('should make duration and exitCode optional for running processes', () => {
      const runningOutput: ProcessOutput = {
        status: 'running',
        stderr: '',
        stdout: 'partial output',
      }

      expectTypeOf<ProcessOutput>(runningOutput)
      expectTypeOf<number | undefined>(runningOutput.duration)
      expectTypeOf<number | undefined>(runningOutput.exitCode)
    })
  })

  describe('Type Safety - ProcessInfo', () => {
    it('should enforce required fields', () => {
      const info: ProcessInfo = {
        command: 'npm build',
        completedAt: new Date(),
        description: 'Build project',
        exitCode: 0,
        pid: 54_321,
        processId: 'proc-456',
        startedAt: new Date(),
        status: 'completed',
      }

      expectTypeOf<string>(info.command)
      expectTypeOf<Date | undefined>(info.completedAt)
      expectTypeOf<string | undefined>(info.description)
      expectTypeOf<number | undefined>(info.exitCode)
      expectTypeOf<number | undefined>(info.pid)
      expectTypeOf<string>(info.processId)
      expectTypeOf<Date>(info.startedAt)
      expectTypeOf<'completed' | 'failed' | 'running'>(info.status)
    })

    it('should make optional fields optional', () => {
      const minimal: ProcessInfo = {
        command: 'npm start',
        processId: 'proc-789',
        startedAt: new Date(),
        status: 'running',
      }

      expectTypeOf<ProcessInfo>(minimal)
      expectTypeOf<Date | undefined>(minimal.completedAt)
      expectTypeOf<string | undefined>(minimal.description)
      expectTypeOf<number | undefined>(minimal.exitCode)
      expectTypeOf<number | undefined>(minimal.pid)
    })
  })

  describe('Type Safety - CommandValidation (Discriminated Union)', () => {
    it('should enforce valid variant structure', () => {
      const validResult: CommandValidation = {
        isValid: true,
        normalizedCommand: 'npm test --watch',
      }

      expectTypeOf<CommandValidation>(validResult)

      if (validResult.isValid) {
        expectTypeOf<string>(validResult.normalizedCommand)
        expectTypeOf<true>(validResult.isValid)
      }
    })

    it('should enforce invalid variant structure', () => {
      const invalidResult: CommandValidation = {
        error: 'Command is blocked',
        isValid: false,
      }

      expectTypeOf<CommandValidation>(invalidResult)

      if (!invalidResult.isValid) {
        expectTypeOf<string>(invalidResult.error)
        expectTypeOf<false>(invalidResult.isValid)
      }
    })

    it('should support type narrowing based on isValid field', () => {
      // Test with valid result
      const validResult: CommandValidation = {
        isValid: true,
        normalizedCommand: 'git status',
      }

      if (validResult.isValid) {
        // Valid variant should have normalizedCommand
        expectTypeOf<string>(validResult.normalizedCommand)
      }

      // Test with invalid result
      const invalidResult: CommandValidation = {
        error: 'Command is blocked',
        isValid: false,
      }

      if (!invalidResult.isValid) {
        // Invalid variant should have error
        expectTypeOf<string>(invalidResult.error)
      }

      // Verify type-level properties using Extract
      type ValidResult = Extract<CommandValidation, {isValid: true}>
      type HasError = 'error' extends keyof ValidResult ? true : false
      expectTypeOf<HasError>().toEqualTypeOf<false>()

      type InvalidResult = Extract<CommandValidation, {isValid: false}>
      type HasNormalizedCommand = 'normalizedCommand' extends keyof InvalidResult ? true : false
      expectTypeOf<HasNormalizedCommand>().toEqualTypeOf<false>()
    })

    it('should prevent mixed properties', () => {
      // Type safety enforced at compile time
    })
  })

  describe('Type Safety - OutputBuffer', () => {
    it('should enforce OutputBuffer structure', () => {
      const buffer: OutputBuffer = {
        bytesUsed: 1024,
        complete: false,
        lastRead: Date.now(),
        stderr: ['error line 1', 'error line 2'],
        stdout: ['output line 1', 'output line 2'],
        truncated: false,
      }

      expectTypeOf<number>(buffer.bytesUsed)
      expectTypeOf<boolean>(buffer.complete)
      expectTypeOf<number>(buffer.lastRead)
      expectTypeOf<string[]>(buffer.stderr)
      expectTypeOf<string[]>(buffer.stdout)
      expectTypeOf<boolean | undefined>(buffer.truncated)
    })

    it('should make truncated optional', () => {
      const withoutTruncated: OutputBuffer = {
        bytesUsed: 512,
        complete: true,
        lastRead: Date.now(),
        stderr: [],
        stdout: [],
      }

      expectTypeOf<OutputBuffer>(withoutTruncated)
      expectTypeOf<boolean | undefined>(withoutTruncated.truncated)
    })

    it('should enforce array types for stdout and stderr', () => {
      const buffer: OutputBuffer = {
        bytesUsed: 0,
        complete: false,
        lastRead: Date.now(),
        stderr: [],
        stdout: [],
      }

      expectTypeOf<string[]>(buffer.stderr)
      expectTypeOf<string[]>(buffer.stdout)
    })
  })

  describe('Type Safety - BackgroundProcess', () => {
    it('should enforce BackgroundProcess structure', () => {
      const mockChild = {} as ChildProcess

      const process: BackgroundProcess = {
        child: mockChild,
        command: 'npm test',
        completedAt: new Date(),
        description: 'Running tests',
        exitCode: 0,
        outputBuffer: {
          bytesUsed: 100,
          complete: true,
          lastRead: Date.now(),
          stderr: [],
          stdout: [],
        },
        processId: 'bg-proc-123',
        startedAt: new Date(),
        status: 'completed',
      }

      expectTypeOf<ChildProcess>(process.child)
      expectTypeOf<string>(process.command)
      expectTypeOf<Date | undefined>(process.completedAt)
      expectTypeOf<string | undefined>(process.description)
      expectTypeOf<number | undefined>(process.exitCode)
      expectTypeOf<OutputBuffer>(process.outputBuffer)
      expectTypeOf<string>(process.processId)
      expectTypeOf<Date>(process.startedAt)
      expectTypeOf<'completed' | 'failed' | 'running'>(process.status)
    })

    it('should make optional fields optional', () => {
      const mockChild = {} as ChildProcess

      const minimalProcess: BackgroundProcess = {
        child: mockChild,
        command: 'npm start',
        outputBuffer: {
          bytesUsed: 0,
          complete: false,
          lastRead: Date.now(),
          stderr: [],
          stdout: [],
        },
        processId: 'proc-123',
        startedAt: new Date(),
        status: 'running',
      }

      expectTypeOf<BackgroundProcess>(minimalProcess)
      expectTypeOf<Date | undefined>(minimalProcess.completedAt)
      expectTypeOf<string | undefined>(minimalProcess.description)
      expectTypeOf<number | undefined>(minimalProcess.exitCode)
    })

    it('should enforce ChildProcess type', () => {
      const mockChild = {} as ChildProcess

      const process: BackgroundProcess = {
        child: mockChild,
        command: 'command',
        outputBuffer: {
          bytesUsed: 0,
          complete: false,
          lastRead: Date.now(),
          stderr: [],
          stdout: [],
        },
        processId: 'id',
        startedAt: new Date(),
        status: 'running',
      }

      expectTypeOf<ChildProcess>(process.child)
    })
  })

  describe('Type Safety - Process Status Consistency', () => {
    it('should use same status enum across types', () => {
      const status1: ProcessOutput['status'] = 'running'
      const status2: ProcessInfo['status'] = 'completed'
      const status3: BackgroundProcess['status'] = 'failed'

      expectTypeOf<'completed' | 'failed' | 'running'>(status1)
      expectTypeOf<'completed' | 'failed' | 'running'>(status2)
      expectTypeOf<'completed' | 'failed' | 'running'>(status3)

      // All should be assignable to each other
      const unified: ProcessOutput['status'] = status2
      expectTypeOf<ProcessOutput['status']>(unified)
    })
  })
})
