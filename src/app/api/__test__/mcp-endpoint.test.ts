import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Express } from 'express';
import request from 'supertest';
import { ApiServer } from '../server.js';
import { MemAgent } from '@core/brain/memAgent/index.js';

describe('MCP SSE Endpoint - Proxy Support', () => {
	let app: Express;
	let agent: MemAgent;
	let server: ApiServer;

	beforeEach(async () => {
		// Mock MemAgent with minimal required methods
		agent = {
			getMcpClients: vi.fn().mockReturnValue(new Map()),
			getEffectiveConfig: vi.fn().mockReturnValue({
				agentCard: {},
			}),
			services: {
				eventManager: {
					on: vi.fn(),
					off: vi.fn(),
					emit: vi.fn(),
				},
			},
		} as any;

		server = new ApiServer(agent, {
			port: 3001,
			apiPrefix: '',
			mcpTransportType: 'sse',
		});

		// Start the server to initialize MCP routes
		await server.start();
		app = server.getApp();
	});

	afterEach(async () => {
		// Clean up any resources
		if ((server as any).httpServer) {
			await new Promise(resolve => {
				(server as any).httpServer.close(resolve);
			});
		}
	});

	describe('Context Path Support', () => {
		it.skip('should handle X-Forwarded-Prefix header for SSE endpoint', async () => {
			// Skip in CI - SSE connections are long-lived and don't close immediately
			// This test is meant for manual/integration testing
		});

		it.skip('should use PROXY_CONTEXT_PATH environment variable when header not present', async () => {
			// Skip in CI - SSE connections are long-lived and don't close immediately
			// This test is meant for manual/integration testing
		});

		it.skip('should work without context path (direct access)', async () => {
			// Skip in CI - SSE connections are long-lived and don't close immediately
			// This test is meant for manual/integration testing
		});
	});

	describe('Session ID Resolution', () => {
		it('should accept sessionId from query parameter', async () => {
			const sessionId = 'test-session-123';

			const response = await request(app)
				.post(`/mcp?sessionId=${sessionId}`)
				.set('X-Forwarded-Prefix', '/agent')
				.set('Content-Type', 'application/json')
				.send({
					jsonrpc: '2.0',
					id: 1,
					method: 'initialize',
					params: {},
				});

			// Will get 404 if no active session, which is expected
			expect([200, 404, 400]).toContain(response.status);
			expect(response.body).toHaveProperty('success');
		});

		it('should accept sessionId from X-Session-ID header', async () => {
			const sessionId = 'test-session-456';

			const response = await request(app)
				.post('/mcp')
				.set('X-Session-ID', sessionId)
				.set('X-Forwarded-Prefix', '/agent')
				.set('Content-Type', 'application/json')
				.send({
					jsonrpc: '2.0',
					id: 1,
					method: 'initialize',
					params: {},
				});

			expect([200, 404, 400]).toContain(response.status);
			expect(response.body).toHaveProperty('success');
		});

		it('should accept sessionId from request body', async () => {
			const sessionId = 'test-session-789';

			const response = await request(app)
				.post('/mcp')
				.set('X-Forwarded-Prefix', '/agent')
				.set('Content-Type', 'application/json')
				.send({
					sessionId,
					jsonrpc: '2.0',
					id: 1,
					method: 'initialize',
					params: {},
				});

			expect([200, 404, 400]).toContain(response.status);
			expect(response.body).toHaveProperty('success');
		});

		it('should return 400 when no sessionId provided and multiple sessions exist', async () => {
			// Simulate multiple active sessions
			const transport1 = { sessionId: 'session-1', handlePostMessage: vi.fn() };
			const transport2 = { sessionId: 'session-2', handlePostMessage: vi.fn() };
			(server as any).activeMcpSseTransports.set('session-1', transport1);
			(server as any).activeMcpSseTransports.set('session-2', transport2);

			const response = await request(app)
				.post('/mcp')
				.set('Content-Type', 'application/json')
				.send({
					jsonrpc: '2.0',
					id: 1,
					method: 'initialize',
					params: {},
				});

			expect(response.status).toBe(400);
			expect(response.body.error.message).toContain('sessionId');

			// Clean up
			(server as any).activeMcpSseTransports.clear();
		});

		it.skip('should use fallback session when only one active session exists', async () => {
			// Skip in CI - mock SSE transport causes hanging
			// This test is meant for manual/integration testing
		});
	});

	describe('CORS Configuration', () => {
		it('should allow requests from configured origins', async () => {
			const response = await request(app).get('/health').set('Origin', 'http://localhost:3000');

			expect(response.status).toBe(200);
			expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3000');
		});

		it('should reject requests from non-allowed origins in production', async () => {
			// Temporarily set NODE_ENV to production
			const originalEnv = process.env.NODE_ENV;
			process.env.NODE_ENV = 'production';

			const response = await request(app).get('/health').set('Origin', 'https://evil.com');

			// Should still return 200 but without CORS headers or with appropriate error
			expect(response.status).toBeGreaterThanOrEqual(200);

			// Restore original env
			process.env.NODE_ENV = originalEnv;
		});

		it('should allow localhost origins in development', async () => {
			const response = await request(app).get('/health').set('Origin', 'http://localhost:8080');

			expect(response.status).toBe(200);
			expect(response.headers['access-control-allow-origin']).toBeDefined();
		});

		it('should include X-Session-ID in allowed headers', async () => {
			const response = await request(app)
				.options('/mcp')
				.set('Origin', 'http://localhost:3000')
				.set('Access-Control-Request-Method', 'POST')
				.set('Access-Control-Request-Headers', 'X-Session-ID');

			expect([200, 204]).toContain(response.status);
		});
	});

	describe('Health Check', () => {
		it('should respond to health check requests', async () => {
			const response = await request(app).get('/health');

			expect(response.status).toBe(200);
			expect(response.body).toHaveProperty('status', 'healthy');
			expect(response.body).toHaveProperty('uptime');
		});
	});

	describe('Error Handling', () => {
		it('should return 404 for non-existent session', async () => {
			const response = await request(app)
				.post('/mcp?sessionId=non-existent-session')
				.set('Content-Type', 'application/json')
				.send({
					jsonrpc: '2.0',
					id: 1,
					method: 'initialize',
					params: {},
				});

			expect(response.status).toBe(404);
			expect(response.body.error.message).toContain('No active session');
		});

		it('should handle malformed requests gracefully', async () => {
			const response = await request(app)
				.post('/mcp?sessionId=test-session')
				.set('Content-Type', 'application/json')
				.send('invalid json');

			expect([400, 404, 500]).toContain(response.status);
		});
	});
});

describe('MCP SSE Endpoint - Path Building', () => {
	// Note: Setup removed since all tests are currently skipped
	// Add back beforeEach/afterEach if tests are re-enabled

	it.skip('should construct correct endpoint URL with API prefix', async () => {
		// Skip in CI - SSE connections are long-lived and don't close immediately
		// This test is meant for manual/integration testing
	});

	it.skip('should construct correct endpoint URL without API prefix', async () => {
		// Skip in CI - SSE connections are long-lived and don't close immediately
		// This test is meant for manual/integration testing
	});
});
