#!/usr/bin/env node

// Fix EventTarget memory leak by setting max listeners early
import { EventEmitter } from 'events';
EventEmitter.defaultMaxListeners = 20;

// Increase AbortSignal max listeners to prevent memory leak warnings
if (typeof globalThis !== 'undefined' && globalThis.EventTarget) {
	const originalAddEventListener = globalThis.EventTarget.prototype.addEventListener;
	const listenerCounts = new WeakMap();
	
	globalThis.EventTarget.prototype.addEventListener = function(type, listener, options) {
		if (type === 'abort' && this.constructor.name === 'AbortSignal') {
			const currentCount = listenerCounts.get(this) || 0;
			if (currentCount >= 15) {
				console.warn(`AbortSignal has ${currentCount} listeners, potential memory leak`);
			}
			listenerCounts.set(this, currentCount + 1);
		}
		return originalAddEventListener.call(this, type, listener, options);
	};
}

import { env } from '@core/env.js';
import { Command } from 'commander';
import pkg from '../../package.json' with { type: 'json' };
import { existsSync } from 'fs';
import { DEFAULT_CONFIG_PATH, logger, MemAgent } from '@core/index.js';
import { resolveConfigPath } from '@core/utils/path.js';
import { handleCliOptionsError, validateCliOptions } from './cli/utils/options.js';
import { loadAgentConfig } from '../core/brain/memAgent/loader.js';
import { startInteractiveCli, startHeadlessCli, startMcpMode } from './cli/cli.js';
import { ApiServer } from './api/server.js';
import { WebServerManager } from './web/web-server.js';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

// Helper function to resolve .env file path
function resolveEnvPath(): string {
	// Try current working directory first
	if (existsSync('.env')) {
		return '.env';
	}

	// Try relative to project root (where package.json is located)
	const currentFileUrl = import.meta.url;
	const currentFilePath = fileURLToPath(currentFileUrl);
	const projectRoot = path.resolve(path.dirname(currentFilePath), '../..');
	const envPath = path.resolve(projectRoot, '.env');

	return envPath;
}

// ===== EARLY MCP MODE DETECTION AND LOG REDIRECTION =====
// Following Cipher's best practices to prevent stdio interference
// This must happen BEFORE any logging operations
const detectAndRedirectMcpLogs = () => {
	const args = process.argv;
	const isMcpMode = args.includes('--mode') && args[args.indexOf('--mode') + 1] === 'mcp';

	if (isMcpMode) {
		// Redirect logs immediately to prevent stdout contamination
		const logFile = process.env.CIPHER_MCP_LOG_FILE || path.join(os.tmpdir(), 'cipher-mcp.log');
		logger.redirectToFile(logFile);

		// Use stderr for critical startup messages only
		process.stderr.write(`[CIPHER-MCP] Log redirection activated: ${logFile}\n`);
	}
};

// Apply early redirection before any other operations
detectAndRedirectMcpLogs();

const program = new Command();

program
	.name('cipher')
	.description(
		'Memory-powered AI agent framework with real-time WebSocket communication and MCP integration'
	)
	.version(pkg.version, '-v, --version', 'output the current version')
	.argument(
		'[prompt...]',
		'Natural-language prompt to run once. If not passed, cipher will start in interactive mode'
	)
	.option('--no-verbose', 'Disable verbose output')
	.option('-a, --agent <path>', 'Path to agent config file', DEFAULT_CONFIG_PATH)
	.option('-s, --strict', 'Require all MCP server connections to succeed')
	.option('--new-session [sessionId]', 'Start with a new session (optionally specify session ID)')
	.option('--mode <mode>', 'The application mode for cipher memory agent - cli | mcp | api | ui', 'cli')
	.option('--port <port>', 'Port for API server (only used with --mode api or ui)', '3001')
	.option('--ui-port <port>', 'Port for UI server (only used with --mode ui)', '3000')
	.option('--host <host>', 'Host for API server (only used with --mode api or ui)', 'localhost')
	.option(
		'--mcp-transport-type <type>',
		'MCP transport type (stdio, sse, streamable-http)',
		'stdio'
	)
	.option('--mcp-port <port>', 'Port for MCP server (only used with sse, streamable-http)', '3000');

program
	.description(
		'Cipher CLI allows you to interact with cipher memory agent.\n' +
			'Run cipher in interactive mode with `cipher` or run a one-shot prompt with `cipher <prompt>`\n\n' +
			'Available modes:\n' +
			'  - cli: Interactive command-line interface (default)\n' +
			'  - mcp: Model Context Protocol server mode\n' +
			'  - api: REST API server mode with WebSocket support\n' +
			'  - ui: Full-stack web application with UI and API server\n\n' +
			'WebSocket Features (API mode):\n' +
			'  • Real-time AI responses and streaming\n' +
			'  • Live tool execution notifications\n' +
			'  • Memory operation events\n' +
			'  • Session management and error handling\n' +
			'  • Available at ws://localhost:3001/ws\n\n' +
			'Options:\n' +
			'  -s, --strict: Require all MCP server connections to succeed (overrides individual server connection modes)\n' +
			'  --new-session [sessionId]: Start with a new session (optionally specify session ID)\n' +
			'  --port <port>: Port for API server (default: 3001, only used with --mode api or ui)\n' +
			'  --ui-port <port>: Port for UI server (default: 3000, only used with --mode ui)\n' +
			'  --host <host>: Host for API server (default: localhost, only used with --mode api or ui)'
	)
	/**
	 * Main CLI action handler for the Cipher agent.
	 *
	 * Strict Mode Behavior:
	 * When the --strict flag is used, all MCP server connectionMode properties
	 * are overridden to 'strict', requiring all server connections to succeed.
	 * This takes precedence over individual server configuration settings.
	 *
	 * If any MCP server fails to connect in strict mode, the application will
	 * exit with an error. Without strict mode, failed connections are logged
	 * as warnings but don't prevent startup.
	 *
	 * New Session Behavior:
	 * When the --new-session flag is used, a new conversation session is created
	 * and made available for the CLI interaction. The session ID parameter is optional:
	 * - --new-session: Creates a session with auto-generated UUID
	 * - --new-session mySessionId: Creates a session with the specified ID
	 *
	 * Created sessions persist for the duration of the CLI session and follow
	 * the agent's session management lifecycle and TTL settings.
	 *
	 * One-Shot Mode Behavior:
	 * When prompt arguments are provided, cipher runs in headless mode:
	 * - Executes the prompt once and exits
	 * - Works with all existing flags and options
	 * - Example: cipher "help me debug this error"
	 */
	.action(async (prompt: string[] = []) => {
		// Process prompt arguments for one-shot mode
		const headlessInput = prompt.join(' ') || undefined;

		// Parse CLI options first
		const opts = program.opts();

		// Check for .env file with proper path resolution (skip in MCP mode)
		if (opts.mode !== 'mcp') {
			const envPath = resolveEnvPath();
			if (!existsSync(envPath)) {
				const errorMsg = `No .env file found at ${envPath}, copy .env.example to .env and fill in the values`;
				logger.error(errorMsg);
				process.exit(1);
			}
		}

		// Check if at least one API key is provided or Ollama is configured
		if (
			!env.OPENAI_API_KEY &&
			!env.ANTHROPIC_API_KEY &&
			!env.OPENROUTER_API_KEY &&
			!env.OLLAMA_BASE_URL
		) {
			// Use MCP-safe error reporting
			const errorMsg =
				'No API key or Ollama configuration found, please set at least one of OPENAI_API_KEY, ANTHROPIC_API_KEY, OPENROUTER_API_KEY, or OLLAMA_BASE_URL in your environment variables \nAvailable providers: OpenAI, Anthropic, OpenRouter, Ollama, Qwen';

			if (opts.mode === 'mcp') {
				process.stderr.write(`[CIPHER-MCP] ERROR: ${errorMsg}\n`);
			} else {
				logger.error(errorMsg);
			}
			process.exit(1);
		}

		// validate cli options
		try {
			validateCliOptions(opts);
		} catch (err) {
			handleCliOptionsError(err);
		}

		// load agent config
		let agent: MemAgent;
		try {
			// Resolve the config path based on the provided agent option
			const configPath = resolveConfigPath(opts.agent);
			logger.info(`Loading agent config from ${configPath}`);

			// Check if config file exists
			if (!existsSync(configPath)) {
				const configErrorMsg = `Config file not found at ${configPath}`;
				const helpMsg =
					opts.agent === DEFAULT_CONFIG_PATH
						? 'Please ensure the config file exists or create one based on memAgent/cipher.yml'
						: `Please ensure the specified config file exists at ${configPath}`;

				if (opts.mode === 'mcp') {
					process.stderr.write(`[CIPHER-MCP] ERROR: ${configErrorMsg}\n[CIPHER-MCP] ${helpMsg}\n`);
				} else {
					logger.error(configErrorMsg);
					logger.error(helpMsg);
				}
				process.exit(1);
			}

			const cfg = await loadAgentConfig(configPath);

			// Apply --strict flag to all MCP server configs if specified
			if (opts.strict && cfg.mcpServers) {
				logger.info('Applying strict mode to all MCP server connections');
				for (const [serverName, serverConfig] of Object.entries(cfg.mcpServers)) {
					logger.debug(`Setting connection mode to strict for server: ${serverName}`);
					serverConfig.connectionMode = 'strict';
				}
			}

			agent = new MemAgent(cfg, opts.mode);

			// Start the agent (initialize async services)
			await agent.start();

			// Handle --new-session flag
			if (opts.newSession !== undefined) {
				try {
					// Use provided session ID or generate a random one
					const sessionId =
						typeof opts.newSession === 'string' && opts.newSession ? opts.newSession : undefined; // Let agent generate random ID

					const session = await agent.createSession(sessionId);

					logger.info(`Created and loaded new session: ${session.id}`, null, 'green');
				} catch (err) {
					logger.error(
						`Failed to create new session: ${err instanceof Error ? err.message : String(err)}`
					);
					process.exit(1);
				}
			}

			// Print OpenAI embedder dimension after agent is started
			if (agent.services && agent.services.embeddingManager) {
				agent.services.embeddingManager.getEmbedder('default');
			} else {
				console.log('No embeddingManager found in agent.services');
			}
		} catch (err) {
			const errorMessage = err instanceof Error ? err.message : String(err);
			const configPath = resolveConfigPath(opts.agent);

			if (opts.mode === 'mcp') {
				// Use stderr for MCP mode errors
				if (opts.strict) {
					process.stderr.write(
						`[CIPHER-MCP] ERROR: Failed to load agent config from ${configPath} (strict mode enabled): ${errorMessage}\n`
					);
					process.stderr.write(
						`[CIPHER-MCP] Strict mode requires all MCP server connections to succeed. Check your MCP server configurations or run without --strict flag.\n`
					);
				} else {
					process.stderr.write(
						`[CIPHER-MCP] ERROR: Failed to load agent config from ${configPath}: ${errorMessage}\n`
					);
				}
			} else {
				// Use logger for non-MCP modes
				if (opts.strict) {
					logger.error(
						`Failed to load agent config from ${configPath} (strict mode enabled):`,
						errorMessage
					);
					logger.error(
						'Strict mode requires all MCP server connections to succeed. Check your MCP server configurations or run without --strict flag to allow lenient connections.'
					);
				} else {
					logger.error(`Failed to load agent config from ${configPath}:`, errorMessage);
				}
			}
			process.exit(1);
		}

		// Handle one-shot mode if prompt arguments were provided
		if (headlessInput) {
			try {
				await startHeadlessCli(agent, headlessInput);
				process.exit(0);
			} catch (err) {
				const errorMessage = err instanceof Error ? err.message : String(err);
				if (opts.mode === 'mcp') {
					process.stderr.write(
						`[CIPHER-MCP] ERROR: Failed to execute headless command: ${errorMessage}\n`
					);
				} else {
					logger.error(`Failed to execute headless command: ${errorMessage}`);
				}
				process.exit(1);
			}
		}

		/**
		 * Start the API server mode
		 */
		async function startApiMode(agent: MemAgent, options: any): Promise<void> {
			const port = parseInt(options.port) || 3001;
			const host = options.host || 'localhost';
			const mcpTransportType = options.mcpTransportType || undefined; // Pass through from CLI options
			const mcpPort = options.mcpPort ? parseInt(options.mcpPort, 10) : undefined; // Pass through from CLI options

			logger.info(`Starting API server on ${host}:${port}`, null, 'green');

			const apiServer = new ApiServer(agent, {
				port,
				host,
				corsOrigins: ['http://localhost:3000', 'http://localhost:3001'], // Default CORS origins
				rateLimitWindowMs: 15 * 60 * 1000, // 15 minutes
				rateLimitMaxRequests: 100, // 100 requests per window
				// Enable WebSocket by default for API mode
				enableWebSocket: true,
				webSocketConfig: {
					path: '/ws',
					maxConnections: 1000,
					connectionTimeout: 300000, // 5 minutes
					heartbeatInterval: 30000, // 30 seconds
					enableCompression: true,
				},
				...(mcpTransportType && { mcpTransportType }), // Only include if defined
				...(mcpPort !== undefined && { mcpPort }), // Only include if defined
			});

			try {
				await apiServer.start();
				logger.info(`API server is running and ready to accept requests`, null, 'green');
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : String(error);
				if (opts.mode === 'mcp') {
					process.stderr.write(`[CIPHER-MCP] ERROR: Failed to start API server: ${errorMsg}\n`);
				} else {
					logger.error(`Failed to start API server: ${errorMsg}`);
				}
				process.exit(1);
			}
		}

		/**
		 * Start the UI mode with both API server and Web UI
		 */
		async function startUiMode(agent: MemAgent, options: any): Promise<void> {
			const apiPort = parseInt(options.port) || 3001;
			const uiPort = parseInt(options.uiPort) || 3000;
			const host = options.host || 'localhost';
			const mcpTransportType = options.mcpTransportType || undefined;
			const mcpPort = options.mcpPort ? parseInt(options.mcpPort, 10) : undefined;

			logger.info(`Starting UI mode - API server on ${host}:${apiPort}, UI server on ${host}:${uiPort}`, null, 'green');

			// Start API server first
			const apiServer = new ApiServer(agent, {
				port: apiPort,
				host,
				corsOrigins: [`http://${host}:${uiPort}`, `http://localhost:${uiPort}`], // Allow UI to connect
				rateLimitWindowMs: 15 * 60 * 1000, // 15 minutes
				rateLimitMaxRequests: 100, // 100 requests per window
				// Enable WebSocket by default for UI mode
				enableWebSocket: true,
				webSocketConfig: {
					path: '/ws',
					maxConnections: 1000,
					connectionTimeout: 300000, // 5 minutes
					heartbeatInterval: 30000, // 30 seconds
					enableCompression: true,
				},
				...(mcpTransportType && { mcpTransportType }),
				...(mcpPort !== undefined && { mcpPort }),
			});

			try {
				await apiServer.start();
				logger.info(`API server is running on ${host}:${apiPort}`, null, 'green');
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : String(error);
				logger.error(`Failed to start API server: ${errorMsg}`);
				process.exit(1);
			}

			// Start Web UI server
			const webServer = new WebServerManager({
				port: uiPort,
				host,
				apiUrl: `http://${host}:${apiPort}`,
				wsUrl: `ws://${host}:${apiPort}`,
			});

			try {
				await webServer.start();
				logger.info(`Web UI server is running on http://${host}:${uiPort}`, null, 'green');
				logger.info(`You can now access the Cipher UI at http://${host}:${uiPort}`, null, 'cyan');
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : String(error);
				logger.error(`Failed to start Web UI server: ${errorMsg}`);
				// Stop API server if UI fails
				logger.info('Stopping API server due to UI startup failure...');
				process.exit(1);
			}

			// Handle graceful shutdown
			const handleShutdown = async () => {
				logger.info('Shutting down UI mode...', null, 'yellow');
				webServer.stop();
				// Give UI server time to shut down
				await new Promise(resolve => setTimeout(resolve, 1000));
				process.exit(0);
			};

			process.on('SIGINT', handleShutdown);
			process.on('SIGTERM', handleShutdown);
		}

		// After agent is started and before entering CLI loop, add:
		if (opts.mode === 'cli') {
			const eventManager = agent.services?.eventManager;
			if (eventManager) {
				const handleExit = async () => {
					try {
						// Emit a session-ended event for the current session
						const sessionId = agent.getCurrentActiveSessionId() || 'default';
						eventManager.emitSessionEvent(sessionId, 'session:expired', {
							sessionId,
							timestamp: Date.now(),
						});
						// Give time for event to be persisted
						await new Promise(res => setTimeout(res, 200));
					} catch {
						// Ignore errors during shutdown
					}
					process.exit(0);
				};
				process.on('SIGINT', handleExit);
				process.on('SIGTERM', handleExit);
			}
		}

		// ——— Dispatch based on --mode ———
		switch (opts.mode) {
			case 'cli':
				await startInteractiveCli(agent);
				break;
			case 'mcp':
				await startMcpMode(agent);
				break;
			case 'api':
				await startApiMode(agent, opts);
				break;
			case 'ui':
				await startUiMode(agent, opts);
				break;
			default: {
				const errorMsg = `Unknown mode '${opts.mode}'. Use cli, mcp, api, or ui.`;
				if (opts.mode === 'mcp') {
					process.stderr.write(`[CIPHER-MCP] ERROR: ${errorMsg}\n`);
				} else {
					logger.error(errorMsg);
				}
				process.exit(1);
			}
		}
	});

program.parseAsync(process.argv);
