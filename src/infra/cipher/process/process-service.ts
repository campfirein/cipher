import {type ChildProcess, spawn} from 'node:child_process'
import {randomBytes} from 'node:crypto'
import {isAbsolute, relative, resolve} from 'node:path'

import type {
  BackgroundProcess,
  ExecuteOptions,
  OutputBuffer,
  ProcessConfig,
  ProcessHandle,
  ProcessInfo,
  ProcessOutput,
  ProcessResult,
} from '../../../core/domain/cipher/process/types.js'
import type {IProcessService} from '../../../core/interfaces/cipher/i-process-service.js'

import {ProcessError} from '../../../core/domain/cipher/errors/process-error.js'
import {CommandValidator} from './command-validator.js'
import {normalizePath} from './path-utils.js'

/**
 * Default timeout for foreground commands (milliseconds).
 */
const DEFAULT_TIMEOUT = 300_000 // 5 minutes

/**
 * Default maximum timeout (milliseconds).
 */
const DEFAULT_MAX_TIMEOUT = 600_000 // 10 minutes

/**
 * Default maximum concurrent background processes.
 */
const DEFAULT_MAX_CONCURRENT_PROCESSES = 5

/**
 * Default maximum output buffer size (bytes).
 */
const DEFAULT_MAX_OUTPUT_BUFFER = 1024 * 1024 // 1MB

/**
 * Default grace period for SIGTERM before SIGKILL (milliseconds).
 * 5 seconds gives processes ample time to clean up gracefully.
 */
const DEFAULT_KILL_GRACE_PERIOD = 5000

/**
 * Process service implementation.
 *
 * Provides secure command execution with:
 * - Multi-layer security validation
 * - Foreground and background execution
 * - Output buffering with size limits
 * - Timeout management with signal escalation
 * - Working directory confinement
 * - Approval system integration
 */
export class ProcessService implements IProcessService {
  private readonly backgroundProcesses: Map<string, BackgroundProcess> = new Map()
  private readonly commandValidator: CommandValidator
  private readonly config: ProcessConfig
  private initialized: boolean = false

  /**
   * Creates a new process service.
   *
   * @param config - Process configuration (partial, will be merged with defaults)
   */
  public constructor(config: Partial<ProcessConfig> = {}) {
    // Merge with defaults
    this.config = {
      allowedCommands: config.allowedCommands || [],
      blockedCommands: config.blockedCommands || [],
      environment: config.environment || {},
      killGracePeriod: config.killGracePeriod ?? DEFAULT_KILL_GRACE_PERIOD,
      maxConcurrentProcesses: config.maxConcurrentProcesses || DEFAULT_MAX_CONCURRENT_PROCESSES,
      maxOutputBuffer: config.maxOutputBuffer || DEFAULT_MAX_OUTPUT_BUFFER,
      maxTimeout: config.maxTimeout || DEFAULT_MAX_TIMEOUT,
      securityLevel: config.securityLevel || 'moderate',
      workingDirectory: config.workingDirectory,
    }

    this.commandValidator = new CommandValidator({
      allowedCommands: this.config.allowedCommands,
      blockedCommands: this.config.blockedCommands,
      securityLevel: this.config.securityLevel,
    })
  }

  /**
   * Clean up completed background processes older than 1 hour.
   */
  public async cleanup(): Promise<void> {
    const now = Date.now()
    const CLEANUP_AGE = 3_600_000 // 1 hour in milliseconds

    for (const [processId, bgProcess] of this.backgroundProcesses.entries()) {
      if (bgProcess.status !== 'running' && bgProcess.completedAt) {
        const age = now - bgProcess.completedAt.getTime()
        if (age > CLEANUP_AGE) {
          this.backgroundProcesses.delete(processId)
        }
      }
    }
  }

  /**
   * Execute a shell command.
   *
   * @param command - Shell command to execute
   * @param options - Execution options
   * @returns Process result or handle
   */
  public async executeCommand(command: string, options: ExecuteOptions = {}): Promise<ProcessHandle | ProcessResult> {
    if (!this.initialized) {
      throw ProcessError.notInitialized()
    }

    // Validate command
    const validation = this.commandValidator.validateCommand(command)

    if (!validation.isValid) {
      throw ProcessError.invalidCommand(command, validation.error)
    }

    const {normalizedCommand} = validation

    // Validate timeout
    const timeout = options.timeout || DEFAULT_TIMEOUT
    if (timeout > this.config.maxTimeout) {
      throw ProcessError.invalidCommand(command, `Timeout ${timeout}ms exceeds maximum ${this.config.maxTimeout}ms`)
    }

    // Resolve working directory
    const cwd = this.resolveSafeCwd(options.cwd)

    // Validate path arguments in the command
    this.validatePathArguments(normalizedCommand, cwd)

    // Merge environment variables
    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries({
      ...process.env,
      ...this.config.environment,
      ...options.env,
    })) {
      if (value !== undefined) {
        env[key] = value
      }
    }

    // Execute based on mode
    if (options.runInBackground) {
      return this.executeInBackground(normalizedCommand, {
        cwd,
        description: options.description,
        env,
        timeout,
      })
    }

    return this.executeForeground(normalizedCommand, {cwd, env, timeout})
  }

  /**
   * Get the current process configuration.
   */
  public getConfig(): Readonly<ProcessConfig> {
    return {...this.config}
  }

  /**
   * Get output from a background process.
   *
   * @param processId - Unique process identifier
   * @returns Process output
   */
  public async getProcessOutput(processId: string): Promise<ProcessOutput> {
    const bgProcess = this.backgroundProcesses.get(processId)
    if (!bgProcess) {
      throw ProcessError.processNotFound(processId)
    }

    // Join output chunks
    const stdout = bgProcess.outputBuffer.stdout.join('')
    const stderr = bgProcess.outputBuffer.stderr.join('')

    // Clear buffer (destructive read)
    bgProcess.outputBuffer.stdout = []
    bgProcess.outputBuffer.stderr = []
    bgProcess.outputBuffer.lastRead = Date.now()
    bgProcess.outputBuffer.bytesUsed = 0

    // Calculate duration if completed
    let duration: number | undefined
    if (bgProcess.completedAt) {
      duration = bgProcess.completedAt.getTime() - bgProcess.startedAt.getTime()
    }

    return {
      duration,
      exitCode: bgProcess.exitCode,
      status: bgProcess.status,
      stderr,
      stdout,
    }
  }

  /**
   * Initialize the process service.
   */
  public async initialize(): Promise<void> {
    // Clear any stale processes
    this.backgroundProcesses.clear()
    this.initialized = true
  }

  /**
   * Terminate a background process.
   *
   * Uses process tree killing to ensure all child processes are terminated.
   *
   * @param processId - Unique process identifier
   */
  public async killProcess(processId: string): Promise<void> {
    const bgProcess = this.backgroundProcesses.get(processId)
    if (!bgProcess) {
      throw ProcessError.processNotFound(processId)
    }

    if (bgProcess.status !== 'running') {
      // Process already terminated
      return
    }

    try {
      // Kill the entire process tree
      await this.killProcessTree(bgProcess.child, bgProcess.child.pid)
    } catch (error) {
      throw ProcessError.killFailed(processId, error instanceof Error ? error.message : String(error))
    }
  }

  /**
   * List all background processes.
   */
  public async listProcesses(): Promise<ProcessInfo[]> {
    const processes: ProcessInfo[] = []

    for (const bgProcess of this.backgroundProcesses.values()) {
      processes.push({
        command: bgProcess.command,
        completedAt: bgProcess.completedAt,
        description: bgProcess.description,
        exitCode: bgProcess.exitCode,
        pid: bgProcess.child.pid,
        processId: bgProcess.processId,
        startedAt: bgProcess.startedAt,
        status: bgProcess.status,
      })
    }

    return processes
  }

  /**
   * Execute command in foreground (wait for completion).
   *
   * @param command - Normalized command to execute
   * @param options - Execution options
   * @param options.cwd - Working directory
   * @param options.env - Environment variables
   * @param options.timeout - Timeout in milliseconds
   * @returns Process result with stdout, stderr, exit code, duration
   */
  private async executeForeground(
    command: string,
    options: {cwd: string; env: Record<string, string>; timeout: number},
  ): Promise<ProcessResult> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now()
      let stdout = ''
      let stderr = ''
      let killed = false
      let closed = false

      // Spawn process
      const child = spawn(command, {
        cwd: options.cwd,
        env: options.env,
        shell: true,
      })

      // Collect stdout
      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString()
      })

      // Collect stderr
      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString()
      })

      // Handle timeout
      const timeoutHandle = setTimeout(() => {
        if (!closed) {
          killed = true
          child.kill('SIGTERM')

          // Escalate to SIGKILL after 5 seconds
          setTimeout(() => {
            if (!closed && child.exitCode === null) {
              child.kill('SIGKILL')
            }
          }, 5000)
        }
      }, options.timeout)

      // Handle process exit
      child.on('close', (code: null | number, signal: NodeJS.Signals | null) => {
        closed = true
        clearTimeout(timeoutHandle)

        const duration = Date.now() - startTime

        if (killed) {
          reject(ProcessError.timeout(command, options.timeout))
          return
        }

        if (signal) {
          reject(ProcessError.executionFailed(command, `Process terminated by signal: ${signal}`))
          return
        }

        resolve({
          duration,
          exitCode: code ?? 1,
          stderr,
          stdout,
        })
      })

      // Handle spawn errors
      child.on('error', (error: NodeJS.ErrnoException) => {
        clearTimeout(timeoutHandle)

        if (error.code === 'ENOENT') {
          reject(ProcessError.commandNotFound(command))
        } else if (error.code === 'EACCES') {
          reject(ProcessError.permissionDenied(command))
        } else {
          reject(ProcessError.executionFailed(command, error.message))
        }
      })
    })
  }

  /**
   * Execute command in background (return immediately).
   *
   * @param command - Normalized command to execute
   * @param options - Execution options
   * @param options.cwd - Working directory
   * @param options.description - Optional description
   * @param options.env - Environment variables
   * @param options.timeout - Timeout in milliseconds
   * @returns Process handle with processId
   */
  private async executeInBackground(
    command: string,
    options: {
      cwd: string
      description?: string
      env: Record<string, string>
      timeout: number
    },
  ): Promise<ProcessHandle> {
    // Check concurrent process limit
    const runningCount = [...this.backgroundProcesses.values()].filter((p) => p.status === 'running').length

    if (runningCount >= this.config.maxConcurrentProcesses) {
      throw ProcessError.tooManyProcesses(runningCount, this.config.maxConcurrentProcesses)
    }

    // Generate unique process ID
    const processId = randomBytes(4).toString('hex')

    // Initialize output buffer
    const outputBuffer: OutputBuffer = {
      bytesUsed: 0,
      complete: false,
      lastRead: Date.now(),
      stderr: [],
      stdout: [],
      truncated: false,
    }

    // Spawn process
    // Use detached: true on Unix to create a process group for tree killing
    const child = spawn(command, {
      cwd: options.cwd,
      detached: process.platform !== 'win32',
      env: options.env,
      shell: true,
    })

    // Prevent child from keeping parent alive on Unix
    if (process.platform !== 'win32') {
      child.unref()
    }

    const startedAt = new Date()

    // Create background process entry
    const bgProcess: BackgroundProcess = {
      child,
      command,
      description: options.description,
      outputBuffer,
      processId,
      startedAt,
      status: 'running',
    }

    this.backgroundProcesses.set(processId, bgProcess)

    // Collect stdout with buffer limit
    child.stdout?.on('data', (data: Buffer) => {
      const chunk = data.toString()
      const chunkBytes = Buffer.byteLength(chunk, 'utf8')

      if (outputBuffer.bytesUsed + chunkBytes <= this.config.maxOutputBuffer) {
        outputBuffer.stdout.push(chunk)
        outputBuffer.bytesUsed += chunkBytes
      } else if (!outputBuffer.truncated) {
        outputBuffer.truncated = true
        // Note: In production, you might want to log this
      }
    })

    // Collect stderr with buffer limit
    child.stderr?.on('data', (data: Buffer) => {
      const chunk = data.toString()
      const chunkBytes = Buffer.byteLength(chunk, 'utf8')

      if (outputBuffer.bytesUsed + chunkBytes <= this.config.maxOutputBuffer) {
        outputBuffer.stderr.push(chunk)
        outputBuffer.bytesUsed += chunkBytes
      } else if (!outputBuffer.truncated) {
        outputBuffer.truncated = true
        // Note: In production, you might want to log this
      }
    })

    // Handle process completion
    child.on('close', (code: null | number, signal: NodeJS.Signals | null) => {
      outputBuffer.complete = true
      bgProcess.completedAt = new Date()
      bgProcess.exitCode = code ?? 1

      if (signal) {
        bgProcess.status = 'failed'
      } else if (code === 0) {
        bgProcess.status = 'completed'
      } else {
        bgProcess.status = 'failed'
      }
    })

    // Handle spawn errors
    child.on('error', () => {
      bgProcess.status = 'failed'
      bgProcess.completedAt = new Date()
      bgProcess.exitCode = 1
      outputBuffer.complete = true
    })

    // Set timeout handler
    const killTimer = setTimeout(() => {
      if (bgProcess.status === 'running') {
        // Use process tree killing for timeout
        this.killProcessTree(child, child.pid).catch(() => {
          // Ignore errors during timeout kill - process may already be dead
        })
      }
    }, options.timeout)

    // Clear timeout when process completes
    child.on('close', () => {
      clearTimeout(killTimer)
    })

    // Return handle immediately
    return {
      command,
      description: options.description,
      pid: child.pid,
      processId,
      startedAt,
    }
  }

  /**
   * Kill a process and all its children (process tree).
   *
   * On Unix, uses process groups (-pid) to kill all descendants.
   * On Windows, uses taskkill with /t flag for tree kill.
   * Falls back to direct kill if process group kill fails.
   *
   * @param child - Child process to kill
   * @param pid - Process ID (optional, extracted from child if not provided)
   * @returns Promise that resolves when kill attempt completes
   */
  private async killProcessTree(child: ChildProcess, pid?: number): Promise<void> {
    const targetPid = pid ?? child.pid
    if (!targetPid) return

    if (process.platform === 'win32') {
      // Use taskkill with /t flag for tree kill on Windows
      return new Promise((resolve) => {
        const killer = spawn('taskkill', ['/pid', String(targetPid), '/f', '/t'], {stdio: 'ignore'})
        killer.once('exit', () => resolve())
        killer.once('error', () => resolve())
      })
    }

    // Unix: kill process group using negative PID
    // Grace period allows processes to clean up gracefully before SIGKILL
    const gracePeriodMs = this.config.killGracePeriod
    try {
      process.kill(-targetPid, 'SIGTERM')
      await this.sleep(gracePeriodMs)
      try {
        process.kill(-targetPid, 'SIGKILL')
      } catch {
        // Process already dead, ignore
      }
    } catch {
      // Fallback to direct kill if process group kill fails
      // (e.g., process wasn't started with detached: true)
      child.kill('SIGTERM')
      await this.sleep(gracePeriodMs)
      if (child.exitCode === null) {
        child.kill('SIGKILL')
      }
    }
  }

  /**
   * Resolve and validate working directory.
   *
   * Ensures the directory is within the configured base directory
   * and prevents directory traversal attacks.
   *
   * @param cwd - Optional working directory (relative or absolute)
   * @returns Safe absolute working directory
   */
  private resolveSafeCwd(cwd?: string): string {
    const baseDir = this.config.workingDirectory || process.cwd()

    // If no cwd specified, use base directory
    if (!cwd) {
      return baseDir
    }

    // Normalize for Git Bash on Windows
    const normalizedCwd = normalizePath(cwd)

    // Resolve to absolute path
    const candidatePath = isAbsolute(normalizedCwd) ? resolve(normalizedCwd) : resolve(baseDir, normalizedCwd)

    // Check if path is within base directory
    const relativePath = relative(baseDir, candidatePath)
    const isOutsideBase = relativePath.startsWith('..') || isAbsolute(relativePath)

    if (isOutsideBase) {
      throw ProcessError.invalidWorkingDirectory(cwd, `Working directory must be within ${baseDir}`)
    }

    return candidatePath
  }

  /**
   * Sleep for specified milliseconds.
   *
   * @param ms - Milliseconds to sleep
   * @returns Promise that resolves after the delay
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms)
    })
  }

  /**
   * Validate file path arguments in a command.
   *
   * Extracts path arguments from path-sensitive commands and validates
   * that they are within the configured base directory.
   *
   * @param command - Command string to validate
   * @param baseDir - Base directory for confinement
   * @throws ProcessError if any path argument is outside the base directory
   */
  private validatePathArguments(command: string, baseDir: string): void {
    const paths = this.commandValidator.extractPathArguments(command)

    for (const pathArg of paths) {
      // Resolve to absolute path
      const resolved = isAbsolute(pathArg) ? resolve(pathArg) : resolve(baseDir, pathArg)

      // Check if path is within base directory
      const relativePath = relative(baseDir, resolved)
      const isOutsideBase = relativePath.startsWith('..') || isAbsolute(relativePath)

      if (isOutsideBase) {
        throw ProcessError.invalidWorkingDirectory(
          pathArg,
          `Path argument "${pathArg}" references location outside ${baseDir}`,
        )
      }
    }
  }
}
