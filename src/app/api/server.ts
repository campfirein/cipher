import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { MemAgent } from '@core/brain/memAgent/index.js';
import { logger } from '@core/logger/index.js';
import { errorResponse, ERROR_CODES } from './utils/response.js';
import {
	requestIdMiddleware,
	requestLoggingMiddleware,
	errorLoggingMiddleware,
} from './middleware/logging.js';
import { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { initializeMcpServer, initializeAgentCardResource } from '@app/mcp/mcp_handler.js';

// Import route handlers
import { createMessageRoutes } from './routes/message.js';
import { createSessionRoutes } from './routes/session.js';
import { createMcpRoutes } from './routes/mcp.js';
import { createConfigRoutes } from './routes/config.js';
import { createLlmRoutes } from './routes/llm.js';

export interface ApiServerConfig {
	port: number;
	host?: string;
	corsOrigins?: string[];
	rateLimitWindowMs?: number;
	rateLimitMaxRequests?: number;
	mcpTransportType?: 'stdio' | 'sse' | 'http';
	mcpPort?: number;
}

export class ApiServer {
	private app: Application;
	private agent: MemAgent;
	private config: ApiServerConfig;
	private mcpServer?: McpServer;
	private activeMcpSseTransports: Map<string, SSEServerTransport> = new Map();

	constructor(agent: MemAgent, config: ApiServerConfig) {
		this.agent = agent;
		this.config = config;
		this.app = express();
		this.setupMiddleware();
		this.setupRoutes();
		this.setupErrorHandling();

		// Note: MCP setup is now handled in start() method to properly handle async operations
	}

	private async setupMcpServer(
		transportType: 'stdio' | 'sse' | 'http',
		_port?: number
	): Promise<void> {
		logger.info(`[API Server] Setting up MCP server with transport type: ${transportType}`);
		try {
			// Initialize agent card data
			const agentCard = this.agent.getEffectiveConfig().agentCard;
			const agentCardInput = agentCard
				? Object.fromEntries(Object.entries(agentCard).filter(([, value]) => value !== undefined))
				: {};
			const agentCardData = initializeAgentCardResource(agentCardInput);

			// Check MCP_SERVER_MODE environment variable to determine server type
			const mcpServerMode = process.env.MCP_SERVER_MODE || 'default';
			logger.info(`[API Server] MCP server mode: ${mcpServerMode}`);

			// Load aggregator configuration if needed
			let aggregatorConfig;
			if (mcpServerMode === 'aggregator') {
				aggregatorConfig = await this.loadAggregatorConfig();
			}

			// Initialize MCP server instance with appropriate mode
			this.mcpServer = await initializeMcpServer(
				this.agent,
				agentCardData,
				mcpServerMode as 'default' | 'aggregator',
				aggregatorConfig
			);

			if (transportType === 'sse') {
				this.setupMcpSseRoutes(); // Renamed for clarity as it sets up both GET and POST
			} else if (transportType === 'stdio') {
				// For stdio, we need to explicitly connect the server to a StdioServerTransport
				// This usually means the process runs as a standalone MCP server, not integrated into Express
				// This case is typically handled by the CLI directly, not via ApiServer
				logger.warn(
					`[API Server] MCP transport type 'stdio' is typically handled by the CLI directly and not integrated into the API server.`
				);
				// If a StdioServerTransport needs to be managed by ApiServer, its lifecycle would be handled here.
				// For now, we assume 'stdio' mode implies a different execution path.
			} else {
				logger.warn(
					`[API Server] MCP transport type '${transportType}' not fully implemented for API server integration yet.`
				);
			}
		} catch (error) {
			logger.error(
				`[API Server] Failed to set up MCP server: ${error instanceof Error ? error.message : String(error)}`
			);
		}
	}

	/**
	 * Load aggregator configuration from environment variables
	 * Aggregator mode now uses agent's unifiedToolManager which automatically includes MCP servers from cipher.yml
	 */
	private async loadAggregatorConfig(): Promise<any> {
		const defaultConfig = {
			type: 'aggregator' as const,
			servers: {}, // No longer needed - using unifiedToolManager
			conflictResolution: (process.env.AGGREGATOR_CONFLICT_RESOLUTION as any) || 'prefix',
			autoDiscovery: false,
			timeout: parseInt(process.env.AGGREGATOR_TIMEOUT || '60000'),
			connectionMode: 'lenient' as const,
		};

		logger.info('[API Server] Using aggregator configuration with env vars', {
			conflictResolution: defaultConfig.conflictResolution,
			timeout: defaultConfig.timeout,
		});
		return defaultConfig;
	}

	private setupMcpSseRoutes(): void {
		if (!this.mcpServer) {
			logger.error('[API Server] MCP Server not initialized for SSE route setup.');
			return;
		}

		// Handle SSE GET endpoint (for client to establish SSE connection)
		this.app.get('/mcp/sse', (req: Request, res: Response) => {
			logger.info('[API Server] New MCP SSE client attempting connection.');
			logger.debug('[API Server] SSE Request Headers:', req.headers);
			logger.debug('[API Server] SSE Request URL:', req.url);

			// Create SSE transport instance. The '/mcp' is the endpoint where client will POST messages.
			// The SSEServerTransport will handle setting the SSE headers itself
			const sseTransport = new SSEServerTransport('/mcp', res);
			logger.debug('[API Server] SSEServerTransport created with endpoint /mcp');

			// Connect MCP server to this SSE transport (this will call sseTransport.start() and set headers)
			this.mcpServer?.connect(sseTransport);
			logger.debug('[API Server] MCP server connected to SSE transport');

			// Store the transport keyed by its session ID
			this.activeMcpSseTransports.set(sseTransport.sessionId, sseTransport);
			logger.info(
				`[API Server] MCP SSE client connected with session ID: ${sseTransport.sessionId}`
			);
			logger.debug(`[API Server] Active SSE transports count: ${this.activeMcpSseTransports.size}`);

			// Handle client disconnect
			req.on('close', () => {
				logger.info(
					`[API Server] MCP SSE client with session ID ${sseTransport.sessionId} disconnected.`
				);
				logger.debug('[API Server] Cleaning up SSE transport and connection');
				sseTransport.close(); // Close the transport when client disconnects
				this.activeMcpSseTransports.delete(sseTransport.sessionId); // Remove from active transports
				logger.debug(
					`[API Server] Active SSE transports count after cleanup: ${this.activeMcpSseTransports.size}`
				);
			});
		});

		// Handle POST requests for MCP messages over HTTP (part of Streamable HTTP)
		this.app.post('/mcp', async (req: Request, res: Response) => {
			logger.debug('[API Server] MCP POST request received');
			logger.debug('[API Server] POST Request Headers:', req.headers);
			logger.debug('[API Server] POST Request Body:', req.body);
			logger.debug('[API Server] POST Request Query:', req.query);

			if (!this.mcpServer) {
				logger.error('[API Server] MCP Server not initialized for POST route.');
				return errorResponse(res, ERROR_CODES.INTERNAL_ERROR, 'MCP Server not ready', 500);
			}

			// The SSEServerTransport expects the session ID to be part of the endpoint it provides,
			// typically as a query parameter in the POST URL (e.g., /mcp?sessionId=...).
			// We need to retrieve the correct transport instance based on this.
			const sessionId = req.query.sessionId as string;

			if (!sessionId) {
				logger.error('[API Server] MCP POST request received without session ID.');
				logger.debug('[API Server] Available query parameters:', Object.keys(req.query));
				return errorResponse(
					res,
					ERROR_CODES.BAD_REQUEST,
					'Missing sessionId in query parameters',
					400
				);
			}

			logger.debug(`[API Server] Looking for SSE transport with session ID: ${sessionId}`);
			logger.debug(
				`[API Server] Available session IDs: ${Array.from(this.activeMcpSseTransports.keys()).join(', ')}`
			);

			const sseTransport = this.activeMcpSseTransports.get(sessionId);

			if (!sseTransport) {
				logger.error(`[API Server] No active MCP SSE transport found for session ID: ${sessionId}`);
				return errorResponse(
					res,
					ERROR_CODES.NOT_FOUND,
					`No active session found for ID: ${sessionId}`,
					404
				);
			}

			try {
				logger.debug(
					`[API Server] Delegating POST message to SSE transport for session: ${sessionId}`
				);
				// Delegate handling of the POST message to the specific SSEServerTransport instance
				// Pass req.body as the third parameter since Express has already parsed it
				await sseTransport.handlePostMessage(req, res, req.body);
				logger.debug(`[API Server] POST message handled successfully for session: ${sessionId}`);
			} catch (error) {
				logger.error(
					`[API Server] Error handling MCP POST request for session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`
				);
				logger.debug(
					`[API Server] POST error stack:`,
					error instanceof Error ? error.stack : 'No stack available'
				);
				errorResponse(
					res,
					ERROR_CODES.INTERNAL_ERROR,
					'Error processing MCP request',
					500,
					error instanceof Error ? error.stack : undefined
				);
			}
		});

		logger.info(
			'[API Server] MCP SSE (GET /mcp/sse) and POST (/mcp?sessionId=...) routes registered.'
		);
	}

	private setupMiddleware(): void {
		// Security middleware
		this.app.use(
			helmet({
				contentSecurityPolicy: false, // Disable CSP for API
				crossOriginEmbedderPolicy: false,
			})
		);

		// CORS configuration
		this.app.use(
			cors({
				origin: this.config.corsOrigins || ['http://localhost:3000'],
				methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
				allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
				credentials: true,
			})
		);

		// Rate limiting
		const limiter = rateLimit({
			windowMs: this.config.rateLimitWindowMs || 15 * 60 * 1000, // 15 minutes
			max: this.config.rateLimitMaxRequests || 100, // limit each IP to 100 requests per windowMs
			message: {
				success: false,
				error: {
					code: ERROR_CODES.RATE_LIMIT_EXCEEDED,
					message: 'Too many requests from this IP, please try again later.',
				},
			},
			standardHeaders: true,
			legacyHeaders: false,
		});
		this.app.use('/api/', limiter);

		// Body parsing middleware
		this.app.use(express.json({ limit: '10mb' })); // Support for image data
		this.app.use(express.urlencoded({ extended: true }));

		// Custom middleware
		this.app.use(requestIdMiddleware);
		this.app.use(requestLoggingMiddleware);
	}

	private setupRoutes(): void {
		// Health check endpoint
		this.app.get('/health', (req: Request, res: Response) => {
			res.json({
				status: 'healthy',
				timestamp: new Date().toISOString(),
				uptime: process.uptime(),
				version: process.env.npm_package_version || 'unknown',
			});
		});

		// API routes
		this.app.use('/api/message', createMessageRoutes(this.agent));
		this.app.use('/api/sessions', createSessionRoutes(this.agent));
		this.app.use('/api/mcp', createMcpRoutes(this.agent));
		this.app.use('/api/llm', createLlmRoutes(this.agent));
		this.app.use('/api/config', createConfigRoutes(this.agent));

		// Note: 404 handler moved to setup404Handler() and called after MCP routes setup
	}

	private setup404Handler(): void {
		// 404 handler for unknown routes - must be registered AFTER all other routes
		this.app.use((req: Request, res: Response) => {
			errorResponse(
				res,
				ERROR_CODES.NOT_FOUND,
				`Route ${req.method} ${req.originalUrl} not found`,
				404,
				undefined,
				req.requestId
			);
		});
	}

	private setupErrorHandling(): void {
		// Error logging middleware
		this.app.use(errorLoggingMiddleware);

		// Global error handler
		this.app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
			// If response already sent, delegate to default Express error handler
			if (res.headersSent) {
				return next(err);
			}

			// Determine error type and status code
			let statusCode = 500;
			let errorCode: string = ERROR_CODES.INTERNAL_ERROR;

			if (err.name === 'ValidationError') {
				statusCode = 400;
				errorCode = ERROR_CODES.VALIDATION_ERROR;
			} else if (err.name === 'UnauthorizedError') {
				statusCode = 401;
				errorCode = ERROR_CODES.UNAUTHORIZED;
			}

			errorResponse(
				res,
				errorCode,
				err.message || 'An unexpected error occurred',
				statusCode,
				process.env.NODE_ENV === 'development' ? err.stack : undefined,
				req.requestId
			);
		});
	}

	public async start(): Promise<void> {
		// Set up MCP server BEFORE starting HTTP server if transport type is provided
		if (this.config.mcpTransportType) {
			try {
				await this.setupMcpServer(this.config.mcpTransportType, this.config.mcpPort);
				logger.info(`[API Server] MCP server setup completed successfully`);
			} catch (error) {
				logger.error(
					`[API Server] Failed to setup MCP server: ${error instanceof Error ? error.message : String(error)}`
				);
				throw error;
			}
		}

		// Set up 404 handler AFTER all routes (including MCP) are registered
		this.setup404Handler();

		return new Promise((resolve, reject) => {
			try {
				const server = this.app.listen(this.config.port, this.config.host || 'localhost', () => {
					logger.info(
						`API Server started on ${this.config.host || 'localhost'}:${this.config.port}`,
						null,
						'green'
					);
					if (this.config.mcpTransportType) {
						logger.info(
							`[API Server] MCP SSE endpoints available at /mcp/sse and /mcp`,
							null,
							'green'
						);
					}
					resolve();
				});

				server.on('error', err => {
					const errorMessage = err.message || err.toString() || 'Unknown error';
					logger.error('Failed to start API server:', errorMessage);
					logger.error('Error details:', err);
					reject(err);
				});

				// Graceful shutdown
				process.on('SIGTERM', () => {
					logger.info('SIGTERM received, shutting down API server gracefully');
					server.close(() => {
						logger.info('API server stopped');
						process.exit(0);
					});
				});

				process.on('SIGINT', () => {
					logger.info('SIGINT received, shutting down API server gracefully');
					server.close(() => {
						logger.info('API server stopped');
						process.exit(0);
					});
				});
			} catch (error) {
				reject(error);
			}
		});
	}

	public getApp(): Application {
		return this.app;
	}
}
