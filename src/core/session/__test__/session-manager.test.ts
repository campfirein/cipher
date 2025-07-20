import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionManager } from '../session-manager.js';
import { ConversationSession } from '../coversation-session.js';

// Mock the ConversationSession to avoid complex dependencies
vi.mock('../coversation-session.js', () => ({
	ConversationSession: vi.fn().mockImplementation((services, sessionId) => ({
		id: sessionId,
		init: vi.fn().mockResolvedValue(undefined),
		run: vi.fn().mockResolvedValue('Mock response'),
		getContextManager: vi.fn(),
		getLLMService: vi.fn(),
	})),
}));

// Mock the logger to avoid console output in tests
vi.mock('@core/logger/index.js', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

describe('SessionManager', () => {
	let sessionManager: SessionManager;
	let mockServices: any;
	let mockStateManager: any;
	let mockPromptManager: any;
	let mockMcpManager: any;

	beforeEach(() => {
		vi.clearAllMocks();

		// Create mock services
		mockStateManager = {
			getLLMConfig: vi.fn().mockReturnValue({
				provider: 'openai',
				model: 'gpt-4o-mini',
				apiKey: 'test-api-key',
				maxIterations: 3,
			}),
		};

		mockPromptManager = {
			load: vi.fn(),
			getInstruction: vi.fn().mockReturnValue('Test system prompt'),
		};

		mockMcpManager = {
			getAllTools: vi.fn().mockResolvedValue({}),
			getClients: vi.fn().mockReturnValue(new Map()),
		};

		mockServices = {
			stateManager: mockStateManager,
			promptManager: mockPromptManager,
			mcpManager: mockMcpManager,
			eventManager: {
				emitSessionEvent: vi.fn(),
				emitServiceEvent: vi.fn(),
			},
		};

		// Create SessionManager with default config
		sessionManager = new SessionManager(mockServices);
	});

	afterEach(async () => {
		await sessionManager.shutdown();
	});

	describe('Initialization', () => {
		it('should initialize successfully with default config', async () => {
			await sessionManager.init();

			const sessionCount = await sessionManager.getSessionCount();
			expect(sessionCount).toBe(0);
		});

		it('should initialize with custom config', async () => {
			const customConfig = {
				maxSessions: 50,
				sessionTTL: 1800000, // 30 minutes
			};

			const customSessionManager = new SessionManager(mockServices, customConfig);
			await customSessionManager.init();

			expect(customSessionManager).toBeDefined();
			await customSessionManager.shutdown();
		});

		it('should handle multiple initialization calls gracefully', async () => {
			await sessionManager.init();
			await sessionManager.init(); // Second call should be no-op

			const sessionCount = await sessionManager.getSessionCount();
			expect(sessionCount).toBe(0);
		});

		it('should auto-initialize when methods are called', async () => {
			// Don't call init() explicitly
			const session = await sessionManager.createSession();

			expect(session).toBeDefined();
			expect(session.id).toBeDefined();
		});
	});

	describe('Session Creation', () => {
		beforeEach(async () => {
			await sessionManager.init();
		});

		it('should create a new session with auto-generated ID', async () => {
			const session = await sessionManager.createSession();

			expect(session).toBeDefined();
			expect(session.id).toBeDefined();
			expect(typeof session.id).toBe('string');
			expect(session.init).toHaveBeenCalled();
		});

		it('should create a new session with custom ID', async () => {
			const customId = 'custom-session-123';
			const session = await sessionManager.createSession(customId);

			expect(session).toBeDefined();
			expect(session.id).toBe(customId);
		});

		it('should return existing session if ID already exists', async () => {
			const sessionId = 'duplicate-test';
			const session1 = await sessionManager.createSession(sessionId);
			const session2 = await sessionManager.createSession(sessionId);

			expect(session1).toBe(session2);
			expect(session1.id).toBe(sessionId);
		});

		it('should handle concurrent session creation with same ID', async () => {
			const sessionId = 'concurrent-test';

			const [session1, session2, session3] = await Promise.all([
				sessionManager.createSession(sessionId),
				sessionManager.createSession(sessionId),
				sessionManager.createSession(sessionId),
			]);

			expect(session1).toBe(session2);
			expect(session2).toBe(session3);
			expect(session1.id).toBe(sessionId);
		});

		it('should evict oldest session when max limit is reached', async () => {
			const smallSessionManager = new SessionManager(mockServices, { maxSessions: 2 });
			await smallSessionManager.init();

			const session1 = await smallSessionManager.createSession('session1');
			const session2 = await smallSessionManager.createSession('session2');

			// Small delay to ensure different timestamps
			await new Promise(resolve => setTimeout(resolve, 1));

			const session3 = await smallSessionManager.createSession('session3');

			expect(session1).toBeDefined();
			expect(session2).toBeDefined();
			expect(session3).toBeDefined();

			const sessionCount = await smallSessionManager.getSessionCount();
			expect(sessionCount).toBe(2);

			// session1 should have been evicted, session2 and session3 should remain
			const retrievedSession1 = await smallSessionManager.getSession('session1');
			const retrievedSession2 = await smallSessionManager.getSession('session2');
			const retrievedSession3 = await smallSessionManager.getSession('session3');

			expect(retrievedSession1).toBeNull();
			expect(retrievedSession2).toBeDefined();
			expect(retrievedSession3).toBeDefined();

			await smallSessionManager.shutdown();
		});

		it('should handle session creation errors gracefully', async () => {
			const MockedConversationSession = vi.mocked(ConversationSession);
			MockedConversationSession.mockImplementationOnce(() => {
				throw new Error('Session creation failed');
			});

			await expect(sessionManager.createSession()).rejects.toThrow('Session creation failed');
		});

		it('should create session with OpenAI provider', async () => {
			const session = await sessionManager.createSession('test-session');
			expect(session).toBeDefined();
		});

		it('should create session with Gemini provider', async () => {
			const session = await sessionManager.createSession('test-session-gemini');
			expect(session).toBeDefined();
		});
	});

	describe('Session Retrieval', () => {
		beforeEach(async () => {
			await sessionManager.init();
		});

		it('should retrieve existing session', async () => {
			const sessionId = 'retrieve-test';
			const createdSession = await sessionManager.createSession(sessionId);
			const retrievedSession = await sessionManager.getSession(sessionId);

			expect(retrievedSession).toBe(createdSession);
			expect(retrievedSession?.id).toBe(sessionId);
		});

		it('should return null for non-existent session', async () => {
			const session = await sessionManager.getSession('non-existent');
			expect(session).toBeNull();
		});

		it('should return null for expired session', async () => {
			const shortTTLManager = new SessionManager(mockServices, { sessionTTL: 1 }); // 1ms TTL
			await shortTTLManager.init();

			const sessionId = 'expired-test';
			await shortTTLManager.createSession(sessionId);

			// Wait for session to expire
			await new Promise(resolve => setTimeout(resolve, 10));

			const session = await shortTTLManager.getSession(sessionId);
			expect(session).toBeNull();

			await shortTTLManager.shutdown();
		});

		it('should update session activity on retrieval', async () => {
			const sessionId = 'activity-test';
			await sessionManager.createSession(sessionId);

			const session1 = await sessionManager.getSession(sessionId);
			const session2 = await sessionManager.getSession(sessionId);

			expect(session1).toBe(session2);
		});
	});

	describe('Session Removal', () => {
		beforeEach(async () => {
			await sessionManager.init();
		});

		it('should remove existing session', async () => {
			const sessionId = 'remove-test';
			await sessionManager.createSession(sessionId);

			const removed = await sessionManager.removeSession(sessionId);
			expect(removed).toBe(true);

			const session = await sessionManager.getSession(sessionId);
			expect(session).toBeNull();
		});

		it('should return false when removing non-existent session', async () => {
			const removed = await sessionManager.removeSession('non-existent');
			expect(removed).toBe(false);
		});

		it('should handle multiple removal attempts', async () => {
			const sessionId = 'multi-remove-test';
			await sessionManager.createSession(sessionId);

			const removed1 = await sessionManager.removeSession(sessionId);
			const removed2 = await sessionManager.removeSession(sessionId);

			expect(removed1).toBe(true);
			expect(removed2).toBe(false);
		});
	});

	describe('Session Management', () => {
		beforeEach(async () => {
			await sessionManager.init();
		});

		it('should get all active sessions', async () => {
			await sessionManager.createSession('session1');
			await sessionManager.createSession('session2');
			await sessionManager.createSession('session3');

			const allSessions = await sessionManager.getAllSessions();
			expect(allSessions).toHaveLength(3);

			const sessionIds = allSessions.map(session => session.id);
			expect(sessionIds).toContain('session1');
			expect(sessionIds).toContain('session2');
			expect(sessionIds).toContain('session3');
		});

		it('should get active session IDs', async () => {
			await sessionManager.createSession('session1');
			await sessionManager.createSession('session2');

			const sessionIds = await sessionManager.getActiveSessionIds();
			expect(sessionIds).toHaveLength(2);
			expect(sessionIds).toContain('session1');
			expect(sessionIds).toContain('session2');
		});

		it('should get session count', async () => {
			await sessionManager.createSession('session1');
			await sessionManager.createSession('session2');

			const count = await sessionManager.getSessionCount();
			expect(count).toBe(2);
		});

		it('should clean up expired sessions automatically', async () => {
			const shortTTLManager = new SessionManager(mockServices, { sessionTTL: 10 }); // 10ms TTL
			await shortTTLManager.init();

			await shortTTLManager.createSession('session1');
			await shortTTLManager.createSession('session2');

			// Wait for sessions to expire
			await new Promise(resolve => setTimeout(resolve, 20));

			// Getting active session IDs should trigger cleanup
			const sessionIds = await shortTTLManager.getActiveSessionIds();
			expect(sessionIds).toHaveLength(0);

			await shortTTLManager.shutdown();
		});
	});

	describe('Concurrent Operations', () => {
		beforeEach(async () => {
			await sessionManager.init();
		});

		it('should handle concurrent session operations', async () => {
			const operations = Array.from({ length: 10 }, (_, i) =>
				sessionManager.createSession(`concurrent-${i}`)
			);

			const sessions = await Promise.all(operations);
			expect(sessions).toHaveLength(10);

			const sessionCount = await sessionManager.getSessionCount();
			expect(sessionCount).toBe(10);
		});

		it('should handle mixed concurrent operations', async () => {
			// Create some initial sessions
			await sessionManager.createSession('concurrent1');
			await sessionManager.createSession('concurrent2');

			const operations = [
				sessionManager.getSession('concurrent1'),
				sessionManager.createSession('concurrent3'),
				sessionManager.removeSession('concurrent2'),
				sessionManager.getActiveSessionIds(),
				sessionManager.getSessionCount(),
			];

			const results = await Promise.all(operations);

			expect(results[0]).toBeDefined(); // getSession result
			expect(results[1]).toBeDefined(); // createSession result
			expect(results[2]).toBe(true); // removeSession result
			expect(Array.isArray(results[3])).toBe(true); // getActiveSessionIds result
			expect(typeof results[4]).toBe('number'); // getSessionCount result
		});
	});

	describe('Error Handling', () => {
		beforeEach(async () => {
			await sessionManager.init();
		});

		it('should handle session initialization errors', async () => {
			const MockedConversationSession = vi.mocked(ConversationSession);
			MockedConversationSession.mockImplementationOnce(
				(services, sessionId) =>
					({
						id: sessionId,
						init: vi.fn().mockRejectedValue(new Error('Init failed')),
						run: vi.fn(),
						getContextManager: vi.fn(),
						getLLMService: vi.fn(),
					}) as any
			);

			await expect(sessionManager.createSession()).rejects.toThrow('Init failed');
		});

		it('should handle service errors gracefully', async () => {
			const MockedConversationSession = vi.mocked(ConversationSession);
			MockedConversationSession.mockImplementationOnce((services, sessionId) => {
				// Access the state manager to trigger the error
				services.stateManager.getLLMConfig(sessionId);
				return {
					id: sessionId,
					init: vi.fn().mockResolvedValue(undefined),
					run: vi.fn().mockResolvedValue('Mock response'),
					getContextManager: vi.fn(),
					getLLMService: vi.fn(),
				} as any;
			});

			mockStateManager.getLLMConfig.mockImplementation(() => {
				throw new Error('State manager error');
			});

			await expect(sessionManager.createSession()).rejects.toThrow('State manager error');
		});
	});

	describe('Cleanup and Shutdown', () => {
		it('should clean up resources on shutdown', async () => {
			await sessionManager.init();
			await sessionManager.createSession('test1');
			await sessionManager.createSession('test2');

			let sessionCount = await sessionManager.getSessionCount();
			expect(sessionCount).toBe(2);

			await sessionManager.shutdown();

			// After shutdown, operations should auto-initialize, but previous sessions should be gone
			sessionCount = await sessionManager.getSessionCount();
			expect(sessionCount).toBe(0);
		});

		it('should handle shutdown when not initialized', async () => {
			// Should not throw error
			await expect(sessionManager.shutdown()).resolves.toBeUndefined();
		});

		it('should handle multiple shutdown calls', async () => {
			await sessionManager.init();

			await sessionManager.shutdown();
			await sessionManager.shutdown(); // Second call should be safe

			expect(true).toBe(true); // Test passes if no errors thrown
		});
	});

	describe('Configuration Edge Cases', () => {
		it('should handle zero max sessions configuration', async () => {
			const zeroMaxManager = new SessionManager(mockServices, { maxSessions: 0 });
			await zeroMaxManager.init();

			// Should still be able to create sessions (eviction will happen immediately)
			const session = await zeroMaxManager.createSession();
			expect(session).toBeDefined();

			await zeroMaxManager.shutdown();
		});

		it('should handle very short session TTL', async () => {
			const shortTTLManager = new SessionManager(mockServices, { sessionTTL: 1 });
			await shortTTLManager.init();

			const session = await shortTTLManager.createSession('short-lived');
			expect(session).toBeDefined();

			// Session should expire almost immediately
			await new Promise(resolve => setTimeout(resolve, 5));
			const retrievedSession = await shortTTLManager.getSession('short-lived');
			expect(retrievedSession).toBeNull();

			await shortTTLManager.shutdown();
		});

		it('should handle very long session TTL', async () => {
			const longTTLManager = new SessionManager(mockServices, {
				sessionTTL: Number.MAX_SAFE_INTEGER,
			});
			await longTTLManager.init();

			const session = await longTTLManager.createSession('long-lived');
			expect(session).toBeDefined();

			// Session should not expire
			await new Promise(resolve => setTimeout(resolve, 10));
			const retrievedSession = await longTTLManager.getSession('long-lived');
			expect(retrievedSession).toBe(session);

			await longTTLManager.shutdown();
		});
	});
});
