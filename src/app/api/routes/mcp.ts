import { Router, Request, Response } from 'express';
import { MemAgent } from '@core/brain/memAgent/index.js';
import { successResponse, errorResponse, ERROR_CODES } from '../utils/response.js';
import {
	validateMcpServerConfig,
	validateMcpServerId,
	validateToolExecution,
	validateListParams,
} from '../middleware/validation.js';
import { logger } from '@core/logger/index.js';

export function createMcpRoutes(agent: MemAgent): Router {
	const router = Router();

	/**
	 * GET /api/mcp/servers
	 * List all connected and failed MCP servers
	 */
	router.get('/servers', validateListParams, async (req: Request, res: Response) => {
		try {
			logger.info('Listing MCP servers', { requestId: req.requestId });

			const clients = agent.getMcpClients();
			const failedConnections = agent.getMcpFailedConnections();

			const connectedServers = Array.from(clients.entries()).map(([name, _client]) => ({
				name,
				status: 'connected',
				// You could add more client metadata here if available
				connected: true,
			}));

			const failedServers = Object.entries(failedConnections).map(([name, error]) => ({
				name,
				status: 'failed',
				error,
				connected: false,
			}));

			successResponse(
				res,
				{
					connected: connectedServers,
					failed: failedServers,
					totalConnected: connectedServers.length,
					totalFailed: failedServers.length,
				},
				200,
				req.requestId
			);
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			logger.error('Failed to list MCP servers', {
				requestId: req.requestId,
				error: errorMsg,
			});

			errorResponse(
				res,
				ERROR_CODES.MCP_SERVER_ERROR,
				`Failed to list MCP servers: ${errorMsg}`,
				500,
				undefined,
				req.requestId
			);
		}
	});

	/**
	 * POST /api/mcp/servers
	 * Connect a new MCP server
	 */
	router.post('/servers', validateMcpServerConfig, async (req: Request, res: Response) => {
		try {
			const { name, ...config } = req.body;

			logger.info('Connecting MCP server', {
				requestId: req.requestId,
				serverName: name,
			});

			await agent.connectMcpServer(name, config);

			successResponse(
				res,
				{
					serverName: name,
					connected: true,
					timestamp: new Date().toISOString(),
				},
				201,
				req.requestId
			);
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			logger.error('Failed to connect MCP server', {
				requestId: req.requestId,
				serverName: req.body.name,
				error: errorMsg,
			});

			// Determine appropriate status code based on error
			let statusCode = 500;
			if (errorMsg.includes('already exists') || errorMsg.includes('duplicate')) {
				statusCode = 409; // Conflict
			} else if (errorMsg.includes('Invalid') || errorMsg.includes('validation')) {
				statusCode = 400; // Bad Request
			}

			errorResponse(
				res,
				ERROR_CODES.MCP_SERVER_ERROR,
				`Failed to connect MCP server: ${errorMsg}`,
				statusCode,
				undefined,
				req.requestId
			);
		}
	});

	/**
	 * DELETE /api/mcp/servers/:serverId
	 * Disconnect an MCP server
	 */
	router.delete('/servers/:serverId', validateMcpServerId, async (req: Request, res: Response) => {
		try {
			const { serverId } = req.params;

			if (!serverId) {
				errorResponse(
					res,
					ERROR_CODES.BAD_REQUEST,
					'Server ID is required',
					400,
					undefined,
					req.requestId
				);
				return;
			}

			logger.info('Disconnecting MCP server', {
				requestId: req.requestId,
				serverId,
			});

			await agent.removeMcpServer(serverId);

			successResponse(
				res,
				{
					serverId,
					disconnected: true,
					timestamp: new Date().toISOString(),
				},
				200,
				req.requestId
			);
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			logger.error('Failed to disconnect MCP server', {
				requestId: req.requestId,
				serverId: req.params.serverId,
				error: errorMsg,
			});

			if (errorMsg.includes('not found')) {
				errorResponse(
					res,
					ERROR_CODES.NOT_FOUND,
					`MCP server ${req.params.serverId} not found`,
					404,
					undefined,
					req.requestId
				);
			} else {
				errorResponse(
					res,
					ERROR_CODES.MCP_SERVER_ERROR,
					`Failed to disconnect MCP server: ${errorMsg}`,
					500,
					undefined,
					req.requestId
				);
			}
		}
	});

	/**
	 * GET /api/mcp/servers/:serverId/tools
	 * List tools for a specific MCP server
	 */
	router.get(
		'/servers/:serverId/tools',
		validateMcpServerId,
		async (req: Request, res: Response) => {
			try {
				const { serverId } = req.params;

				if (!serverId) {
					errorResponse(
						res,
						ERROR_CODES.BAD_REQUEST,
						'Server ID is required',
						400,
						undefined,
						req.requestId
					);
					return;
				}

				logger.info('Listing tools for MCP server', {
					requestId: req.requestId,
					serverId,
				});

				const clients = agent.getMcpClients();
				const client = clients.get(serverId);

				if (!client) {
					errorResponse(
						res,
						ERROR_CODES.NOT_FOUND,
						`MCP server ${serverId} not found or not connected`,
						404,
						undefined,
						req.requestId
					);
					return;
				}

				// Get tools from the client
				const toolSet = await client.getTools();
				const tools = Object.entries(toolSet).map(([name, tool]) => ({
					name,
					description: tool.description,
					parameters: tool.parameters,
				}));

				successResponse(
					res,
					{
						serverId,
						tools,
						count: tools.length,
					},
					200,
					req.requestId
				);
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : String(error);
				logger.error('Failed to list tools for MCP server', {
					requestId: req.requestId,
					serverId: req.params.serverId,
					error: errorMsg,
				});

				errorResponse(
					res,
					ERROR_CODES.MCP_SERVER_ERROR,
					`Failed to list tools: ${errorMsg}`,
					500,
					undefined,
					req.requestId
				);
			}
		}
	);

	/**
	 * POST /api/mcp/servers/:serverId/tools/:toolName/execute
	 * Execute a tool on a specific MCP server
	 */
	router.post(
		'/servers/:serverId/tools/:toolName/execute',
		validateToolExecution,
		async (req: Request, res: Response) => {
			try {
				const { serverId, toolName } = req.params;

				if (!serverId || !toolName) {
					errorResponse(
						res,
						ERROR_CODES.BAD_REQUEST,
						'Server ID and tool name are required',
						400,
						undefined,
						req.requestId
					);
					return;
				}
				const { arguments: toolArgs } = req.body;

				logger.info('Executing MCP tool', {
					requestId: req.requestId,
					serverId,
					toolName,
					hasArguments: Boolean(toolArgs),
				});

				// Check if server exists
				const clients = agent.getMcpClients();
				const client = clients.get(serverId);

				if (!client) {
					errorResponse(
						res,
						ERROR_CODES.NOT_FOUND,
						`MCP server ${serverId} not found or not connected`,
						404,
						undefined,
						req.requestId
					);
					return;
				}

				// Execute the tool through the agent's unified tool manager
				const result = await agent.executeMcpTool(toolName, toolArgs || {});

				successResponse(
					res,
					{
						serverId,
						toolName,
						result,
						executed: true,
						timestamp: new Date().toISOString(),
					},
					200,
					req.requestId
				);
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : String(error);
				logger.error('Failed to execute MCP tool', {
					requestId: req.requestId,
					serverId: req.params.serverId,
					toolName: req.params.toolName,
					error: errorMsg,
				});

				// Determine appropriate status code
				let statusCode = 500;
				if (errorMsg.includes('not found') || errorMsg.includes('unknown tool')) {
					statusCode = 404;
				} else if (errorMsg.includes('invalid') || errorMsg.includes('validation')) {
					statusCode = 400;
				}

				errorResponse(
					res,
					ERROR_CODES.MCP_SERVER_ERROR,
					`Failed to execute tool: ${errorMsg}`,
					statusCode,
					undefined,
					req.requestId
				);
			}
		}
	);

	return router;
}
