/**
 * Bash Command Tool for Cipher
 *
 * Provides bash command execution capabilities within the Cipher agent framework.
 * Adapted from OpenHands implementation with Cipher-specific integrations.
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { platform } from 'os';
import {
	createInternalToolName,
	type InternalTool,
	type InternalToolHandler,
} from '../../types.js';
import { logger } from '../../../../logger/index.js';

/**
 * Get the appropriate shell command and args for the current OS
 */
function getShellCommand(): { shell: string; args: string[] } {
	if (platform() === 'win32') {
		return { shell: 'cmd.exe', args: ['/c'] };
	}
	return { shell: '/bin/bash', args: ['-c'] };
}

/**
 * Command execution result structure
 */
interface CommandResult {
	output: string;
	error: string;
	exitCode: number;
	command: string;
	duration: number;
	pid: number | undefined;
	workingDir: string | undefined;
}

/**
 * Command execution options
 */
interface CommandOptions {
	command: string;
	timeout?: number;
	workingDir?: string;
	environment?: Record<string, string>;
	shell?: string;
}

/**
 * Bash session manager for persistent command execution
 */
class BashSession extends EventEmitter {
	private process: ChildProcess | null = null;
	private outputBuffer = '';
	private errorBuffer = '';
	private isRunning = false;
	private currentWorkingDir: string;
	private sessionId: string;

	constructor(sessionId: string, workingDir: string = process.cwd()) {
		super();
		this.sessionId = sessionId;
		this.currentWorkingDir = workingDir;
	}

	/**
	 * Initialize the bash session
	 */
	async initialize(): Promise<void> {
		if (this.process) {
			logger.warn(`BashSession ${this.sessionId}: Already initialized`);
			return;
		}

		try {
			// Start bash process with non-interactive mode to avoid prompt issues
			const { shell, args } = getShellCommand();
			this.process = spawn(shell, args, {
				cwd: this.currentWorkingDir,
				stdio: ['pipe', 'pipe', 'pipe'],
				env: { ...process.env },
			});

			this.isRunning = true;

			// Handle process output
			this.process.stdout?.on('data', (data: Buffer) => {
				this.outputBuffer += data.toString();
			});

			this.process.stderr?.on('data', (data: Buffer) => {
				this.errorBuffer += data.toString();
			});

			this.process.on('exit', (code, signal) => {
				this.isRunning = false;
				logger.debug(
					`BashSession ${this.sessionId}: Process exited with code ${code}, signal ${signal}`
				);
				this.emit('exit', { code, signal });
			});

			this.process.on('error', error => {
				this.isRunning = false;
				logger.error(`BashSession ${this.sessionId}: Process error`, error);
				this.emit('error', error);
			});

			// Give the process a moment to start
			await new Promise(resolve => setTimeout(resolve, 100));

			logger.debug(`BashSession ${this.sessionId}: Initialized successfully`);
		} catch (error) {
			logger.error(`BashSession ${this.sessionId}: Failed to initialize`, error);
			throw error;
		}
	}

	/**
	 * Execute a command in the session
	 */
	async executeCommand(command: string, timeout: number = 30000): Promise<CommandResult> {
		if (!this.process || !this.isRunning) {
			throw new Error('Bash session is not running');
		}

		const startTime = Date.now();

		// Clear buffers for this command
		this.outputBuffer = '';
		this.errorBuffer = '';

		return new Promise<CommandResult>((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				reject(new Error(`Command timeout after ${timeout}ms`));
			}, timeout);

			// Send command with a unique marker to detect completion
			const marker = `CMD_COMPLETE_${Date.now()}`;
			const fullCommand = `${command}; echo "${marker}"; echo "EXIT_CODE:$?" `;
			this.process!.stdin?.write(`${fullCommand}\n`);

			// Wait for command completion
			const checkCompletion = () => {
				if (this.outputBuffer.includes(marker)) {
					clearTimeout(timeoutId);

					// Extract output before the marker
					const parts = this.outputBuffer.split(marker);
					const output = parts[0]?.trim() || '';

					// Try to extract exit code
					const exitCodeMatch = this.outputBuffer.match(/EXIT_CODE:(\d+)/);
					const exitCode = exitCodeMatch?.[1] ? parseInt(exitCodeMatch[1], 10) : 0;

					const result: CommandResult = {
						output,
						error: this.errorBuffer.trim(),
						exitCode,
						command,
						duration: Date.now() - startTime,
						pid: this.process?.pid,
						workingDir: this.currentWorkingDir || undefined,
					};

					resolve(result);
				} else {
					setTimeout(checkCompletion, 100);
				}
			};

			// Start checking after a brief delay
			setTimeout(checkCompletion, 50);
		});
	}

	/**
	 * Close the bash session
	 */
	async close(): Promise<void> {
		if (this.process) {
			this.process.stdin?.write('exit\n');
			this.process.kill();
			this.process = null;
			this.isRunning = false;
			logger.debug(`BashSession ${this.sessionId}: Closed`);
		}
	}

	/**
	 * Check if session is running
	 */
	isActive(): boolean {
		return this.isRunning && this.process !== null;
	}
}

/**
 * Session manager for maintaining multiple bash sessions
 */
class BashSessionManager {
	private sessions = new Map<string, BashSession>();
	private static instance: BashSessionManager;

	static getInstance(): BashSessionManager {
		if (!BashSessionManager.instance) {
			BashSessionManager.instance = new BashSessionManager();
		}
		return BashSessionManager.instance;
	}

	/**
	 * Get or create a bash session
	 */
	async getSession(sessionId: string, workingDir?: string): Promise<BashSession> {
		let session = this.sessions.get(sessionId);

		if (!session || !session.isActive()) {
			session = new BashSession(sessionId, workingDir);
			await session.initialize();
			this.sessions.set(sessionId, session);
		}

		return session;
	}

	/**
	 * Close a specific session
	 */
	async closeSession(sessionId: string): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (session) {
			await session.close();
			this.sessions.delete(sessionId);
		}
	}

	/**
	 * Close all sessions
	 */
	async closeAllSessions(): Promise<void> {
		const closePromises = Array.from(this.sessions.values()).map(session => session.close());
		await Promise.all(closePromises);
		this.sessions.clear();
	}
}

/**
 * Execute a bash command with optional session persistence
 */
async function executeBashCommand(options: CommandOptions): Promise<CommandResult> {
	const { command, timeout = 30000, workingDir, environment } = options;

	logger.debug('Executing bash command', { command, timeout, workingDir });

	const startTime = Date.now();

	return new Promise<CommandResult>((resolve, reject) => {
		const timeoutId = setTimeout(() => {
			reject(new Error(`Command timeout after ${timeout}ms`));
		}, timeout);

		let output = '';
		let error = '';

		const { shell, args } = getShellCommand();
		const childProcess = spawn(shell, [...args, command], {
			cwd: workingDir || process.cwd(),
			env: { ...process.env, ...environment },
			stdio: ['pipe', 'pipe', 'pipe'],
		});

		childProcess.stdout?.on('data', (data: Buffer) => {
			output += data.toString();
		});

		childProcess.stderr?.on('data', (data: Buffer) => {
			error += data.toString();
		});

		childProcess.on('close', (code: number | null) => {
			clearTimeout(timeoutId);

			const result: CommandResult = {
				output: output.trim(),
				error: error.trim(),
				exitCode: code || 0,
				command,
				duration: Date.now() - startTime,
				pid: childProcess.pid,
				workingDir: workingDir || process.cwd() || undefined,
			};

			logger.debug('Bash command completed', {
				command,
				exitCode: result.exitCode,
				duration: result.duration,
			});

			resolve(result);
		});

		childProcess.on('error', (err: Error) => {
			clearTimeout(timeoutId);
			logger.error('Bash command failed', { command, error: err.message });
			reject(err);
		});
	});
}

/**
 * Bash tool handler implementation
 */
const bashHandler: InternalToolHandler = async (args, context) => {
	const {
		command,
		timeout = 30000,
		workingDir,
		persistent = false,
		sessionId: customSessionId,
	} = args;

	if (!command || typeof command !== 'string') {
		return {
			content: 'Error: Command is required and must be a string',
			isError: true,
		};
	}

	try {
		let result: CommandResult;

		if (persistent) {
			// Use persistent session
			const sessionManager = BashSessionManager.getInstance();
			const sessionId = customSessionId || context?.sessionId || 'default';
			const session = await sessionManager.getSession(sessionId, workingDir);
			result = await session.executeCommand(command, timeout);
		} else {
			// Execute as one-off command
			result = await executeBashCommand({
				command,
				timeout,
				workingDir,
			});
		}

		// Format result for agent consumption
		const formattedOutput = [
			`Command: ${result.command}`,
			`Exit Code: ${result.exitCode}`,
			`Duration: ${result.duration}ms`,
			result.workingDir ? `Working Dir: ${result.workingDir}` : '',
			'',
			'Output:',
			result.output || '(no output)',
			result.error ? '\nError:' : '',
			result.error || '',
		]
			.filter(Boolean)
			.join('\n');

		// Store command result in memory if context has services
		if (context?.services?.vectorStoreManager && result.output) {
			try {
				// This would typically go through the memory extraction system
				logger.debug('Command result could be stored in memory', { command });
			} catch (memoryError) {
				logger.warn('Failed to store command result in memory', memoryError);
			}
		}

		return {
			content: formattedOutput,
			isError: result.exitCode !== 0,
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		logger.error('Bash tool execution failed', { command, error: errorMessage });

		return {
			content: `Error executing command: ${errorMessage}`,
			isError: true,
		};
	}
};

/**
 * Bash tool definition
 */
export const bashTool: InternalTool = {
	name: createInternalToolName('bash'),
	category: 'system',
	internal: true,
	agentAccessible: true,
	description:
		'Execute bash commands in the system shell. Supports both one-off commands and persistent session execution.',
	parameters: {
		type: 'object',
		properties: {
			command: {
				type: 'string',
				description:
					'The bash command to execute. Can be a single command or a chain of commands using && or ;',
			},
			timeout: {
				type: 'number',
				description: 'Timeout in milliseconds for command execution (default: 30000)',
				default: 30000,
			},
			workingDir: {
				type: 'string',
				description: 'Working directory for command execution (defaults to current directory)',
			},
			persistent: {
				type: 'boolean',
				description: 'Whether to use a persistent bash session (maintains state between commands)',
				default: false,
			},
			sessionId: {
				type: 'string',
				description: 'Session ID for persistent sessions (defaults to context session ID)',
			},
		},
		required: ['command'],
	},
	handler: bashHandler,
	version: '1.0.0',
};

// Export session manager for cleanup
export { BashSessionManager };
