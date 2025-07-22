/**
 * Aggregator MCP Handler for exposing aggregated tools as a unified MCP server.
 *
 * This file contains the handler for running Cipher in aggregator mode,
 * using the same working connection logic as default mode but exposing all tools.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { logger } from '@core/logger/index.js';
import type { AggregatorConfig } from '@core/mcp/types.js';
import { createMcpTransport } from './mcp_handler.js';
import type { MemAgent } from '@core/brain/memAgent/agent.js';

/**
 * Initialize aggregator MCP server
 * @param config - Aggregator configuration
 * @param agent - MemAgent instance for handling built-in tools
 */
export async function initializeAggregatorServer(
	config: AggregatorConfig,
	agent: MemAgent
): Promise<void> {
	logger.info(
		'[Aggregator Handler] Initializing aggregator MCP server (using unified tool manager)',
		{
			conflictResolution: config.conflictResolution,
			timeout: config.timeout,
		}
	);

	// Create MCP server instance (same as default mode)
	const server = new Server(
		{
			name: 'cipher-aggregator',
			version: '1.0.0',
		},
		{
			capabilities: {
				tools: {},
			},
		}
	);

	// Register tools using unified tool manager (like default mode)
	await registerAggregatedTools(server, agent, config);

	// Create transport (using same utility as default MCP handler)
	const transport = await createMcpTransport('stdio');

	// Connect server to transport
	logger.info('[Aggregator Handler] Connecting aggregator server to stdio transport');
	await server.connect(transport.server);

	logger.info('[Aggregator Handler] Aggregator MCP server initialized and connected successfully');
	logger.info('[Aggregator Handler] All tools are now available to external clients');

	// Handle shutdown gracefully
	process.on('SIGINT', async () => {
		logger.info('[Aggregator Handler] Shutting down aggregator server');
		process.exit(0);
	});

	process.on('SIGTERM', async () => {
		logger.info('[Aggregator Handler] Shutting down aggregator server');
		process.exit(0);
	});

	// Keep the process alive
	process.stdin.resume();
}

/**
 * Handle the ask_cipher tool execution
 */
async function handleAskCipherTool(agent: MemAgent, args: any): Promise<any> {
	const { message, session_id = 'default' } = args;

	if (!message || typeof message !== 'string') {
		throw new Error('Message parameter is required and must be a string');
	}

	logger.info('[Aggregator Handler] Processing ask_cipher request', {
		sessionId: session_id,
		messageLength: message.length,
	});

	try {
		const result = await agent.run(message, session_id);

		return {
			content: [
				{
					type: 'text',
					text: result?.response || 'No response generated',
				},
			],
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		logger.error('[Aggregator Handler] Error in ask_cipher tool', { error: errorMessage });
		throw new Error(`Agent execution failed: ${errorMessage}`);
	}
}

/**
 * Register aggregated tools as MCP tools (using default mode's working logic)
 */
async function registerAggregatedTools(
	server: Server,
	agent: MemAgent,
	config: AggregatorConfig
): Promise<void> {
	logger.debug('[Aggregator Handler] Registering all tools (built-in + MCP servers)');

	// Get all agent-accessible tools from unifiedToolManager (like default mode)
	const unifiedToolManager = agent.unifiedToolManager;
	const combinedTools = await unifiedToolManager.getAllTools();

	// Apply conflict resolution if needed
	const resolvedTools = new Map<string, any>();
	const conflictResolution = config?.conflictResolution || 'prefix';

	Object.entries(combinedTools).forEach(([toolName, tool]) => {
		let resolvedName = toolName;

		// Check for conflicts and resolve based on strategy
		if (resolvedTools.has(toolName)) {
			switch (conflictResolution) {
				case 'prefix':
					resolvedName = `cipher.${toolName}`;
					logger.info(
						`[Aggregator Handler] Tool name conflict resolved: ${toolName} -> ${resolvedName}`
					);
					break;
				case 'first-wins':
					logger.warn(
						`[Aggregator Handler] Tool name conflict: ${toolName} already exists, skipping`
					);
					return; // Skip this tool
				case 'error':
					throw new Error(`Tool name conflict: ${toolName} exists multiple times`);
				default:
					resolvedName = toolName;
			}
		}

		resolvedTools.set(resolvedName, tool);
	});

	// Build MCP tool list from resolved tools
	const mcpTools = Array.from(resolvedTools.entries()).map(([toolName, tool]) => ({
		name: toolName,
		description: (tool as any).description,
		inputSchema: (tool as any).parameters,
	}));

	// For backward compatibility, ensure ask_cipher is always present
	if (!mcpTools.find(t => t.name === 'ask_cipher')) {
		mcpTools.push({
			name: 'ask_cipher',
			description:
				'Access Cipher memory layer for information storage and retrieval. Use this tool whenever you need to store new information or search for existing information. Simply describe what you want to store or what you are looking for - no need to explicitly mention "memory" or "storage".',
			inputSchema: {
				type: 'object',
				properties: {
					message: {
						type: 'string',
						description: 'The message or question to send to the Cipher agent',
					},
					session_id: {
						type: 'string',
						description: 'Optional session ID to maintain conversation context',
						default: 'default',
					},
					stream: {
						type: 'boolean',
						description: 'Whether to stream the response (not supported via MCP)',
						default: false,
					},
				},
				required: ['message'],
			},
		});
	}

	logger.info(
		`[Aggregator Handler] Registering ${mcpTools.length} tools: ${mcpTools.map(t => t.name).join(', ')}`
	);

	// Register list tools handler (using default mode's working logic)
	server.setRequestHandler(ListToolsRequestSchema, async () => {
		return { tools: mcpTools };
	});

	// Register call tool handler (using default mode's working logic)
	server.setRequestHandler(CallToolRequestSchema, async request => {
		const { name, arguments: args } = request.params;
		logger.info(`[Aggregator Handler] Tool called: ${name}`, { toolName: name, args });

		if (name === 'ask_cipher') {
			return await handleAskCipherTool(agent, args);
		}

		// Route to unifiedToolManager for all other tools (like default mode)
		try {
			const unifiedToolManager = agent.unifiedToolManager;

			// Apply timeout if configured
			const timeout = config?.timeout || 60000;
			const result = await Promise.race([
				unifiedToolManager.executeTool(name, args),
				new Promise((_, reject) =>
					setTimeout(
						() => reject(new Error(`Tool execution timed out after ${timeout}ms`)),
						timeout
					)
				),
			]);

			return {
				content: [
					{
						type: 'text',
						text: typeof result === 'string' ? result : JSON.stringify(result),
					},
				],
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			logger.error(`[Aggregator Handler] Error in tool '${name}'`, { error: errorMessage });
			throw new Error(`Tool execution failed: ${errorMessage}`);
		}
	});
}
