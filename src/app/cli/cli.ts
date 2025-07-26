import { MemAgent, logger } from '@core/index.js';
import * as readline from 'readline';
import chalk from 'chalk';
import { executeCommand } from './commands.js';
import { commandParser } from './parser.js';
import type { AggregatorConfig } from '@core/mcp/types.js';
// Constants for compression display
const COMPRESSION_CHECK_DELAY = 100;

// State tracking for compression display
let lastCompressionHistoryLength = 0;


/**
 * Start headless CLI mode for one-shot command execution
 * @param agent - The MemAgent instance
 * @param input - The user input/prompt to execute
 */
export async function startHeadlessCli(agent: MemAgent, input: string): Promise<void> {
	await _initCli(agent);

	if (input.trim().startsWith('!meta ')) {
		const metaAndMessage = input.trim().substring(6).split(' ');
		const metaStr = metaAndMessage[0];
		const message = metaAndMessage.slice(1).join(' ');
		let metadata: Record<string, any> = {};
		try {
			// Add null check for metaStr before passing to parseMetaString
			if (metaStr) {
				metadata = parseMetaString(metaStr);
			}
		} catch {
			console.log(chalk.red('❌ Invalid metadata format. Use key=value,key2=value2 ...'));
			return;
		}
		console.log(chalk.gray('🤔 Processing (with metadata)...'));
		const result = await agent.run(message, undefined, undefined, false, {
			memoryMetadata: metadata,
		});
		if (result && result.backgroundOperations) {
			try {
				await result.backgroundOperations;
			} catch {
				/* no-op: background operation errors are intentionally ignored */
			}
		}
		if (result && result.response) {
			logger.displayAIResponse(result.response);
		} else {
			console.log(chalk.gray('No response received.'));
		}
	} else {
		console.log(chalk.gray('🤔 Processing...'));
		const result = await agent.run(input);
		if (result && result.backgroundOperations) {
			try {
				await result.backgroundOperations;
			} catch {
				/* no-op: background operation errors are intentionally ignored */
			}
		}
		if (result && result.response) {
			logger.displayAIResponse(result.response);
		} else {
			console.log(chalk.gray('No response received.'));
		}
	}
}

/**
 * Start interactive CLI mode where user can continuously chat with the agent
 */
export async function startInteractiveCli(agent: MemAgent): Promise<void> {
	// Common initialization
	await _initCli(agent);
	await _initializeSessionAndCompression(agent);

	console.log(chalk.cyan('🚀 Welcome to Cipher Interactive CLI!'));
	console.log(chalk.gray('Your memory-powered coding assistant is ready.'));
	console.log(chalk.gray('• Type /help to see available commands'));
	console.log(chalk.gray('• Use /exit or /quit to end the session'));
	console.log(chalk.gray('• Regular messages will be sent to the AI agent\n'));

	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
		prompt: chalk.blue('cipher> '),
	});

	// Set up graceful shutdown
	const handleExit = () => {
		console.log(chalk.yellow('\n👋 Goodbye! Your conversation has been saved to memory.'));
		rl.close();
		process.exit(0);
	};

	rl.on('SIGINT', handleExit);
	rl.on('SIGTERM', handleExit);

	rl.prompt();

	rl.on('line', async (input: string) => {
		const trimmedInput = input.trim();

		// Skip empty inputs
		if (!trimmedInput) {
			rl.prompt();
			return;
		}

		try {

			if (trimmedInput.startsWith('!meta ')) {
				// Parse metadata command: !meta key=value,key2=value2 message
				const metaAndMessage = trimmedInput.substring(6).split(' ');
				const metaStr = metaAndMessage[0];
				let message = metaAndMessage.slice(1).join(' ');
				let metadata: Record<string, any> = {};
				try {
					// Add null check for metaStr before passing to parseMetaString
					if (metaStr) {
						metadata = parseMetaString(metaStr);
					}
				} catch {
					console.log(chalk.red('❌ Invalid metadata format. Use key=value,key2=value2 ...'));
					rl.prompt();
					return;
				}

				console.log(chalk.gray('🤔 Thinking (with metadata)...'));
				const result = await agent.run(message, undefined, undefined, false, {
					memoryMetadata: metadata,
				});
				if (result && result.backgroundOperations) {
					try {
						await result.backgroundOperations;
					} catch {
						/* no-op: background operation errors are intentionally ignored */
					}
				}
				if (result && result.response) {
					logger.displayAIResponse(result.response);
				} else {
					console.log(chalk.gray('No response received.'));
				}

				// Show compression info after processing
				await _showCompressionInfo(agent);

				// At info log level, display prompt immediately and let background operations run silently
				if (result && result.backgroundOperations) {
					// Check if we're at info log level or higher (info level = 2, anything higher means less verbose)
					const currentLogLevel = process.env.CIPHER_LOG_LEVEL || 'info';
					const isInfoLevelOrHigher = ['error', 'warn', 'info'].includes(currentLogLevel);

					if (isInfoLevelOrHigher) {
						// At info level, show prompt immediately
						rl.prompt();

						// Let background operations run silently in the background
						result.backgroundOperations.catch(() => {
							// Background operation errors are intentionally ignored at info level
						});
					} else {
						// At debug/verbose levels, wait for background operations to complete
						result.backgroundOperations
							.catch(() => {
								// Background operations failures are already logged, don't show to user
							})
							.finally(() => {
								// Small delay to ensure any error logs are fully written before redisplaying prompt
								setTimeout(() => {
									rl.prompt();
								}, COMPRESSION_CHECK_DELAY);
							});
					}
				} else {
					rl.prompt();
				}
			} else {
				const parsedInput = commandParser.parseInput(trimmedInput);

				if (parsedInput.isCommand) {
					// Handle slash command
					if (parsedInput.command && parsedInput.args !== undefined) {
						const commandSuccess = await executeCommand(
							parsedInput.command,
							parsedInput.args,
							agent
						);

						if (!commandSuccess) {
							console.log(chalk.gray('Command execution failed or was cancelled.'));
						}
					} else {
						console.log(chalk.red('❌ Invalid command format'));
						commandParser.displayHelp();
					}
					// Always redisplay prompt after slash commands
					rl.prompt();
				} else {
					// Handle regular user prompt - pass to agent
					console.log(chalk.gray('🤔 Thinking...'));
					const result = await agent.run(trimmedInput);

					// Display the AI response immediately
					if (result && result.response) {
						// Display the AI response with nice formatting
						logger.displayAIResponse(result.response);
					} else {
						console.log(chalk.gray('No response received.'));
					}

					// Show compression info after processing
					await _showCompressionInfo(agent);

					// At info log level, display prompt immediately and let background operations run silently
					if (result && result.backgroundOperations) {
						// Check if we're at info log level or higher (info level = 2, anything higher means less verbose)
						const currentLogLevel = process.env.CIPHER_LOG_LEVEL || 'info';
						const isInfoLevelOrHigher = ['error', 'warn', 'info'].includes(currentLogLevel);

						if (isInfoLevelOrHigher) {
							// At info level, show prompt immediately
							rl.prompt();

							// Let background operations run silently in the background
							result.backgroundOperations.catch(() => {
								// Background operation errors are intentionally ignored at info level
							});
						} else {
							// At debug/verbose levels, wait for background operations to complete
							result.backgroundOperations
								.catch(() => {
									// Background operations failures are already logged, don't show to user
								})
								.finally(() => {
									// Small delay to ensure any error logs are fully written before redisplaying prompt
									setTimeout(() => {
										rl.prompt();
									}, COMPRESSION_CHECK_DELAY);
								});
						}
					} else {
						rl.prompt();
					}
				}
			}
		} catch (error) {
			logger.error(
				`Error processing input: ${error instanceof Error ? error.message : String(error)}`
			);
			rl.prompt();
		}
	});

	rl.on('close', () => {
		console.log(chalk.yellow('\n👋 Session ended. Your conversation has been saved to memory.'));
		process.exit(0);
	});
}

/**
 * Start MCP server mode for Model Context Protocol integration
 */
export async function startMcpMode(agent: MemAgent): Promise<void> {
	// DO NOT use console.log in MCP mode - it interferes with stdio protocol
	// Log redirection is already done in index.ts before calling this function

	// Initialize CLI without additional logging
	if (!agent) {
		throw new Error('Agent is not initialized');
	}

	// Check MCP_SERVER_MODE environment variable to determine server type
	// Default to 'default' if not specified (backward compatibility)
	const mcpServerMode = process.env.MCP_SERVER_MODE || 'default';

	try {
		switch (mcpServerMode) {
			case 'aggregator':
				await startAggregatorMode(agent);
				break;
			case 'default':
			default:
				await startDefaultMcpMode(agent);
				break;
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		logger.error(`[MCP Mode] Failed to start MCP server (mode: ${mcpServerMode}): ${errorMessage}`);
		process.exit(1);
	}
}

/**
 * Start the default MCP server mode with ask_cipher tool
 */
async function startDefaultMcpMode(agent: MemAgent): Promise<void> {
	// Import MCP handler functions
	const { createMcpTransport, initializeMcpServer, initializeAgentCardResource } = await import(
		'../mcp/mcp_handler.js'
	);

	// Get agent configuration for agent card
	const config = agent.getEffectiveConfig();
	// Filter out undefined properties to comply with exactOptionalPropertyTypes
	const agentCardInput = config.agentCard
		? Object.fromEntries(
				Object.entries(config.agentCard).filter(([, value]) => value !== undefined)
			)
		: {};
	const agentCardData = initializeAgentCardResource(agentCardInput);

	// Create stdio transport (primary transport for MCP mode)
	logger.info('[MCP Mode] Creating stdio transport for default MCP server');
	const mcpTransport = await createMcpTransport('stdio');

	// Initialize MCP server with agent capabilities (default mode)
	logger.info('[MCP Mode] Initializing default MCP server with agent capabilities');
	const server = await initializeMcpServer(agent, agentCardData, 'default');
	await server.connect(mcpTransport.server);

	// Server is now running - keep process alive
	logger.info('[MCP Mode] Cipher agent is now running as default MCP server');
	process.stdin.resume();
}

/**
 * Start the aggregator MCP server mode
 */
async function startAggregatorMode(agent: MemAgent): Promise<void> {
	// Import MCP handler functions
	const { createMcpTransport, initializeMcpServer, initializeAgentCardResource } = await import(
		'../mcp/mcp_handler.js'
	);

	// Load aggregator configuration from environment or default config
	const aggregatorConfig = await loadAggregatorConfig();

	// Get agent configuration for agent card
	const config = agent.getEffectiveConfig();
	// Filter out undefined properties to comply with exactOptionalPropertyTypes
	const agentCardInput = config.agentCard
		? Object.fromEntries(
				Object.entries(config.agentCard).filter(([, value]) => value !== undefined)
			)
		: {};
	const agentCardData = initializeAgentCardResource(agentCardInput);

	// Create stdio transport (primary transport for MCP mode)
	logger.info('[MCP Mode] Creating stdio transport for aggregator MCP server');
	const mcpTransport = await createMcpTransport('stdio');

	// Initialize MCP server with agent capabilities (aggregator mode)
	logger.info('[MCP Mode] Initializing aggregator MCP server with agent capabilities');
	const server = await initializeMcpServer(agent, agentCardData, 'aggregator', aggregatorConfig);
	await server.connect(mcpTransport.server);

	// Server is now running - keep process alive
	logger.info('[MCP Mode] Cipher is now running as aggregator MCP server');
	process.stdin.resume();
}

/**
 * Load aggregator configuration from environment variables
 * Aggregator mode now uses agent's unifiedToolManager which automatically includes MCP servers from cipher.yml
 */
async function loadAggregatorConfig(): Promise<AggregatorConfig> {
	const defaultConfig: AggregatorConfig = {
		type: 'aggregator',
		servers: {}, // No longer needed - using unifiedToolManager
		conflictResolution: (process.env.AGGREGATOR_CONFLICT_RESOLUTION as any) || 'prefix',
		autoDiscovery: false,
		timeout: parseInt(process.env.AGGREGATOR_TIMEOUT || '60000'),
		connectionMode: 'lenient',
	};

	logger.info('[MCP Aggregator] Using simplified configuration with env vars', {
		conflictResolution: defaultConfig.conflictResolution,
		timeout: defaultConfig.timeout,
	});
	return defaultConfig;
}

/**
 * Common CLI initialization logic
 */
async function _initCli(agent: MemAgent): Promise<void> {
	logger.info('Initializing CLI interface...');

	// Ensure agent is started
	if (!agent) {
		throw new Error('Agent is not initialized');
	}

	logger.info('CLI interface ready');
}

/**
 * Initialize session and display compression startup info (only for interactive mode)
 */
async function _initializeSessionAndCompression(agent: MemAgent): Promise<void> {
	// Wait a bit for session to be ready
	await new Promise(resolve => setTimeout(resolve, 50));

	const session = await agent.getSession(agent.getCurrentSessionId());

	if (session && typeof session.init === 'function') {
		await session.init();
	}

	// Wait a bit more for compression system to be fully initialized
	await new Promise(resolve => setTimeout(resolve, 50));

	await _showCompressionStartup(agent);
	await new Promise(res => process.stderr.write('', res));
}

/**
 * Show compression system startup information
 */
async function _showCompressionStartup(agent: MemAgent): Promise<void> {
	try {
		const session = await agent.getSession(agent.getCurrentSessionId());

		if (!session) {
			// Session not ready yet, skip compression info silently
			return;
		}

		const ctx = session.getContextManager();
		if (!ctx) {
			return;
		}

		const stats = ctx.getTokenStats();

		if (stats.maxTokens > 0) {
			console.log(chalk.green('🧠 Token-Aware Compression System is ACTIVE'));
			console.log(
				chalk.gray(
					`• Max tokens: ${stats.maxTokens}, Compression strategy: ${ctx['compressionStrategy']?.name || 'unknown'}`
				)
			);

			lastCompressionHistoryLength = ctx['compressionHistory']?.length || 0;
		}
	} catch {
		// Intentionally empty - compression info is optional
	}
}

/**
 * Show compression info after each interaction
 */
async function _showCompressionInfo(agent: MemAgent): Promise<void> {
	try {
		const session = await agent.getSession(agent.getCurrentSessionId());

		if (!session) {
			return;
		}

		const ctx = session.getContextManager();
		const history = ctx['compressionHistory'];

		if (Array.isArray(history) && history.length > lastCompressionHistoryLength) {
			const event = history[history.length - 1];
			_displayCompressionEvent(event);
			lastCompressionHistoryLength = history.length;
		}
	} catch {
		// Intentionally empty - compression info is optional
	}
}

/**
 * Display compression event information
 */
function _displayCompressionEvent(event: any): void {
	console.log(chalk.yellowBright('⚡ Context has been compressed.'));
}

// Add utility for parsing metadata from CLI
export function parseMetaString(metaStr: string): Record<string, any> {
	const metadata: Record<string, any> = {};
	if (!metaStr) return metadata;
	const pairs = metaStr.split(',');
	for (const pair of pairs) {
		const [key, value] = pair.split('=');
		if (!key || value === undefined || value === '') {
			throw new Error('Invalid metadata pair');
		}
		metadata[key.trim()] = value.trim();
	}
	return metadata;
}
