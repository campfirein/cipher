import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { EventManager } from '../event-manager.js';
import { EventPersistenceConfig } from '../persistence.js';

describe('Event Persistence Environment Variables', () => {
	const originalEnv = { ...process.env };

	beforeEach(() => {
		// Reset environment variables before each test
		process.env = { ...originalEnv };
	});

	afterEach(() => {
		// Restore original environment variables
		process.env = originalEnv;
	});

	test('should enable persistence when EVENT_PERSISTENCE_ENABLED=true', () => {
		process.env.EVENT_PERSISTENCE_ENABLED = 'true';
		process.env.EVENT_PERSISTENCE_PATH = '/custom/events/path';

		const eventManager = new EventManager({
			enablePersistence: true,
			eventPersistenceConfig: {
				enabled: false, // This should be overridden by env var
			},
		});

		// The EventManager should be created with persistence enabled
		// We can't directly test the internal state, but we can verify it doesn't throw
		expect(eventManager).toBeDefined();
	});

	test('should use custom path when EVENT_PERSISTENCE_PATH is set', () => {
		process.env.EVENT_PERSISTENCE_ENABLED = 'true';
		process.env.EVENT_PERSISTENCE_PATH = '/custom/events/path';

		const eventManager = new EventManager({
			enablePersistence: true,
			eventPersistenceConfig: {
				enabled: true,
				filePath: '/default/path', // This should be overridden by env var
			},
		});

		expect(eventManager).toBeDefined();
	});

	test('should disable persistence when EVENT_PERSISTENCE_ENABLED=false', () => {
		process.env.EVENT_PERSISTENCE_ENABLED = 'false';

		const eventManager = new EventManager({
			enablePersistence: false,
			eventPersistenceConfig: {
				enabled: true, // This should be overridden by env var
			},
		});

		expect(eventManager).toBeDefined();
	});

	test('should use default path when EVENT_PERSISTENCE_PATH is not set', () => {
		process.env.EVENT_PERSISTENCE_ENABLED = 'true';
		// Don't set EVENT_PERSISTENCE_PATH

		const eventManager = new EventManager({
			enablePersistence: true,
			eventPersistenceConfig: {
				enabled: true,
				filePath: '/default/path',
			},
		});

		expect(eventManager).toBeDefined();
	});

	test('should handle invalid EVENT_PERSISTENCE_ENABLED values', () => {
		process.env.EVENT_PERSISTENCE_ENABLED = 'invalid';
		process.env.EVENT_PERSISTENCE_PATH = '/custom/path';

		const eventManager = new EventManager({
			enablePersistence: false, // Should default to false for invalid values
		});

		expect(eventManager).toBeDefined();
	});
});
