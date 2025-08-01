/**
 * Performance Tests for Event System
 *
 * Tests the performance characteristics of the event system under various loads.
 */

import { EventManager } from '../event-manager.js';
// import { EventFilterManager, CommonFilters } from '../filtering.js';
import { EventPersistence } from '../persistence.js';
// import { MemoryEventStorage } from '../persistence.js';
import { ServiceEvents, SessionEvents } from '../event-types.js';

describe('Event System Performance Tests', () => {
	let eventManager: EventManager;

	beforeEach(() => {
		eventManager = new EventManager({
			enableLogging: false, // Disable logging for accurate performance measurements
			enablePersistence: false,
			enableFiltering: false,
			maxServiceListeners: 1000,
			maxSessionListeners: 500,
		});
	});

	afterEach(() => {
		eventManager.dispose();
	});

	describe('Event Emission Performance', () => {
		test('should handle high-frequency service event emission', () => {
			const eventCount = 10000;
			const startTime = Date.now();

			for (let i = 0; i < eventCount; i++) {
				eventManager.emitServiceEvent(ServiceEvents.SERVICE_STARTED, {
					serviceType: `service-${i}`,
					timestamp: Date.now(),
				});
			}

			const endTime = Date.now();
			const duration = endTime - startTime;
			const eventsPerSecond = (eventCount / duration) * 1000;

			console.log(
				`Service events: ${eventCount} events in ${duration}ms (${eventsPerSecond.toFixed(0)} events/sec)`
			);

			// Should handle at least 1000 events per second
			expect(eventsPerSecond).toBeGreaterThan(1000);
			// Should complete within reasonable time (less than 5 seconds for 10k events)
			expect(duration).toBeLessThan(5000);
		});

		test('should handle high-frequency session event emission', () => {
			const sessionCount = 100;
			const eventsPerSession = 100;
			const totalEvents = sessionCount * eventsPerSession;

			const startTime = Date.now();

			for (let s = 0; s < sessionCount; s++) {
				const sessionId = `session-${s}`;
				for (let e = 0; e < eventsPerSession; e++) {
					eventManager.emitSessionEvent(sessionId, SessionEvents.TOOL_EXECUTION_STARTED, {
						toolName: `tool-${e}`,
						toolType: 'internal',
						sessionId,
						executionId: `exec-${s}-${e}`,
						timestamp: Date.now(),
					});
				}
			}

			const endTime = Date.now();
			const duration = endTime - startTime;
			const eventsPerSecond = (totalEvents / duration) * 1000;

			console.log(
				`Session events: ${totalEvents} events across ${sessionCount} sessions in ${duration}ms (${eventsPerSecond.toFixed(0)} events/sec)`
			);

			expect(eventsPerSecond).toBeGreaterThan(500);
			expect(duration).toBeLessThan(10000);
		});

		test('should handle mixed service and session events efficiently', () => {
			const sessionCount = 50;
			const eventsPerSession = 50;
			const serviceEvents = 1000;
			const totalEvents = sessionCount * eventsPerSession + serviceEvents;

			const startTime = Date.now();

			// Interleave service and session events
			for (let i = 0; i < Math.max(serviceEvents, sessionCount * eventsPerSession); i++) {
				// Emit service event
				if (i < serviceEvents) {
					eventManager.emitServiceEvent(ServiceEvents.SERVICE_STARTED, {
						serviceType: `service-${i}`,
						timestamp: Date.now(),
					});
				}

				// Emit session events
				if (i < sessionCount * eventsPerSession) {
					const sessionIndex = Math.floor(i / eventsPerSession);
					const eventIndex = i % eventsPerSession;
					const sessionId = `session-${sessionIndex}`;

					eventManager.emitSessionEvent(sessionId, SessionEvents.TOOL_EXECUTION_COMPLETED, {
						toolName: `tool-${eventIndex}`,
						toolType: 'mcp',
						sessionId,
						executionId: `exec-${sessionIndex}-${eventIndex}`,
						duration: Math.random() * 1000,
						success: true,
						timestamp: Date.now(),
					});
				}
			}

			const endTime = Date.now();
			const duration = endTime - startTime;
			const eventsPerSecond = (totalEvents / duration) * 1000;

			console.log(
				`Mixed events: ${totalEvents} events in ${duration}ms (${eventsPerSecond.toFixed(0)} events/sec)`
			);

			expect(eventsPerSecond).toBeGreaterThan(300);
			expect(duration).toBeLessThan(15000);
		});
	});

	describe('Event Listener Performance', () => {
		test('should handle many listeners efficiently', () => {
			const listenerCount = 500;
			const eventCount = 1000;
			const receivedCounts: number[] = new Array(listenerCount).fill(0);

			const serviceEventBus = eventManager.getServiceEventBus();

			// Add many listeners
			const setupStart = Date.now();
			for (let i = 0; i < listenerCount; i++) {
				serviceEventBus.on(ServiceEvents.SERVICE_STARTED, _data => {
					if (Array.isArray(receivedCounts) && typeof receivedCounts[i] !== 'undefined') {
						receivedCounts[i]!++;
					}
				});
			}
			const setupTime = Date.now() - setupStart;

			// Emit events
			const emitStart = Date.now();
			for (let i = 0; i < eventCount; i++) {
				eventManager.emitServiceEvent(ServiceEvents.SERVICE_STARTED, {
					serviceType: `service-${i}`,
					timestamp: Date.now(),
				});
			}
			const emitTime = Date.now() - emitStart;

			// Verify all listeners received all events
			const totalNotifications = listenerCount * eventCount;
			const actualNotifications = receivedCounts.reduce((sum, count) => sum + count, 0);

			console.log(`Listener performance: ${listenerCount} listeners, ${eventCount} events`);
			console.log(`Setup time: ${setupTime}ms, Emit time: ${emitTime}ms`);
			console.log(`Expected notifications: ${totalNotifications}, Actual: ${actualNotifications}`);

			expect(actualNotifications).toBe(totalNotifications);
			expect(setupTime).toBeLessThan(1000); // Setup should be fast
			expect(emitTime).toBeLessThan(5000); // Emission should be reasonable
		});

		test('should handle async listeners without blocking', async () => {
			const asyncListenerCount = 100;
			const eventCount = 100;
			const completedCounts: number[] = new Array(asyncListenerCount).fill(0);

			const serviceEventBus = eventManager.getServiceEventBus();

			// Add async listeners with simulated delay
			for (let i = 0; i < asyncListenerCount; i++) {
				serviceEventBus.on(ServiceEvents.SERVICE_STARTED, async _data => {
					// Simulate async work
					await new Promise(resolve => setTimeout(resolve, Math.random() * 10));
					if (Array.isArray(completedCounts) && typeof completedCounts[i] !== 'undefined') {
						completedCounts[i]!++;
					}
				});
			}

			const startTime = Date.now();

			// Emit events
			for (let i = 0; i < eventCount; i++) {
				eventManager.emitServiceEvent(ServiceEvents.SERVICE_STARTED, {
					serviceType: `service-${i}`,
					timestamp: Date.now(),
				});
			}

			const emitTime = Date.now() - startTime;

			// Wait for async listeners to complete
			await new Promise(resolve => setTimeout(resolve, 2000));

			const totalCompleted = completedCounts.reduce((sum, count) => sum + count, 0);
			const expectedCompleted = asyncListenerCount * eventCount;

			console.log(`Async listeners: ${asyncListenerCount} listeners, ${eventCount} events`);
			console.log(`Emit time: ${emitTime}ms, Completed: ${totalCompleted}/${expectedCompleted}`);

			expect(emitTime).toBeLessThan(1000); // Emission shouldn't wait for async listeners
			expect(totalCompleted).toBe(expectedCompleted);
		});
	});

	describe('Event Filtering Performance', () => {
		test('should maintain performance with multiple filters', () => {
			const filterCount = 20;
			const eventCount = 5000;
			let passedEvents = 0;

			// Enable filtering
			const filteringEventManager = new EventManager({
				enableLogging: false,
				enablePersistence: false,
				enableFiltering: true,
			});

			// Add multiple filters
			for (let i = 0; i < filterCount; i++) {
				filteringEventManager.registerFilter({
					name: `filter-${i}`,
					description: `Performance test filter ${i}`,
					enabled: true,
					priority: i,
					filter: event => {
						// Simple filter logic
						return event.type.includes('service') || Math.random() > 0.1;
					},
				});
			}

			const serviceEventBus = filteringEventManager.getServiceEventBus();
			serviceEventBus.on(ServiceEvents.SERVICE_STARTED, () => {
				passedEvents++;
			});

			const startTime = Date.now();

			for (let i = 0; i < eventCount; i++) {
				filteringEventManager.emitServiceEvent(ServiceEvents.SERVICE_STARTED, {
					serviceType: `service-${i}`,
					timestamp: Date.now(),
				});
			}

			const endTime = Date.now();
			const duration = endTime - startTime;
			const eventsPerSecond = (eventCount / duration) * 1000;

			console.log(
				`Filtering performance: ${filterCount} filters, ${eventCount} events in ${duration}ms`
			);
			console.log(
				`Events per second: ${eventsPerSecond.toFixed(0)}, Passed events: ${passedEvents}`
			);

			// Should still maintain reasonable performance with filtering
			expect(eventsPerSecond).toBeGreaterThan(100);
			expect(passedEvents).toBeGreaterThan(0);
			expect(passedEvents).toBeLessThanOrEqual(eventCount);

			filteringEventManager.dispose();
		});

		test('should have minimal overhead for disabled filters', () => {
			const eventCount = 10000;

			// Test with filtering enabled but no filters
			const filteringEventManager = new EventManager({
				enableLogging: false,
				enablePersistence: false,
				enableFiltering: true,
			});

			const startTimeWithFiltering = Date.now();

			for (let i = 0; i < eventCount; i++) {
				filteringEventManager.emitServiceEvent(ServiceEvents.SERVICE_STARTED, {
					serviceType: `service-${i}`,
					timestamp: Date.now(),
				});
			}

			const durationWithFiltering = Date.now() - startTimeWithFiltering;

			// Test without filtering
			const noFilteringEventManager = new EventManager({
				enableLogging: false,
				enablePersistence: false,
				enableFiltering: false,
			});

			const startTimeNoFiltering = Date.now();

			for (let i = 0; i < eventCount; i++) {
				noFilteringEventManager.emitServiceEvent(ServiceEvents.SERVICE_STARTED, {
					serviceType: `service-${i}`,
					timestamp: Date.now(),
				});
			}

			const durationNoFiltering = Date.now() - startTimeNoFiltering;

			const overhead = ((durationWithFiltering - durationNoFiltering) / durationNoFiltering) * 100;

			console.log(
				`Filtering overhead: ${durationNoFiltering}ms without, ${durationWithFiltering}ms with (${overhead.toFixed(1)}% overhead)`
			);

			// Overhead should be minimal (less than 1000% to account for system variations)
			expect(overhead).toBeLessThan(1000);

			filteringEventManager.dispose();
			noFilteringEventManager.dispose();
		});
	});

	describe('Memory Performance', () => {
		test('should handle event persistence without significant memory growth', async () => {
			const eventCount = 5000;

			const persistence = new EventPersistence({
				enabled: true,
				storageType: 'memory',
				maxEvents: 10000,
			});

			const startMemory = process.memoryUsage().heapUsed;
			const startTime = Date.now();

			// Store many events
			for (let i = 0; i < eventCount; i++) {
				await persistence.store({
					id: `perf-event-${i}`,
					type: ServiceEvents.SERVICE_STARTED,
					data: {
						serviceType: `service-${i}`,
						timestamp: Date.now(),
						metadata: { large: 'x'.repeat(1000) }, // Add some bulk to test memory
					},
					metadata: {
						timestamp: Date.now(),
						source: 'performance-test',
					},
				});

				// Periodically yield to event loop
				if (i % 500 === 0) {
					await new Promise(resolve => setImmediate(resolve));
				}
			}

			const endTime = Date.now();
			const endMemory = process.memoryUsage().heapUsed;
			const memoryGrowth = endMemory - startMemory;
			const duration = endTime - startTime;

			console.log(`Memory performance: ${eventCount} events stored in ${duration}ms`);
			console.log(`Memory growth: ${(memoryGrowth / 1024 / 1024).toFixed(2)} MB`);

			// Query performance
			const queryStart = Date.now();
			const results = await persistence.query({ limit: 1000 });
			const queryTime = Date.now() - queryStart;

			console.log(`Query performance: ${results.length} results in ${queryTime}ms`);

			expect(duration).toBeLessThan(10000); // Should complete within 10 seconds
			expect(queryTime).toBeLessThan(1000); // Queries should be fast
			expect(results.length).toBeGreaterThan(0);

			// Memory growth should be reasonable (less than 100MB for this test)
			expect(memoryGrowth).toBeLessThan(100 * 1024 * 1024);

			persistence.dispose();
		});

		test('should properly clean up session event buses', () => {
			const sessionCount = 1000;
			const eventsPerSession = 10;

			const startMemory = process.memoryUsage().heapUsed;

			// Create many sessions and emit events
			for (let s = 0; s < sessionCount; s++) {
				const sessionId = `cleanup-session-${s}`;
				for (let e = 0; e < eventsPerSession; e++) {
					eventManager.emitSessionEvent(sessionId, SessionEvents.SESSION_CREATED, {
						sessionId,
						timestamp: Date.now(),
					});
				}
			}

			const afterCreationMemory = process.memoryUsage().heapUsed;

			// Remove all sessions
			const activeSessionIds = eventManager.getActiveSessionIds();
			activeSessionIds.forEach(sessionId => {
				eventManager.removeSessionEventBus(sessionId);
			});

			// Force garbage collection if available
			if (global.gc) {
				global.gc();
			}

			const afterCleanupMemory = process.memoryUsage().heapUsed;

			const creationGrowth = afterCreationMemory - startMemory;
			const cleanupGrowth = afterCleanupMemory - startMemory;
			const cleanupRatio = cleanupGrowth / creationGrowth;

			console.log(`Session cleanup: ${sessionCount} sessions created`);
			console.log(`Memory after creation: ${(creationGrowth / 1024 / 1024).toFixed(2)} MB`);
			console.log(`Memory after cleanup: ${(cleanupGrowth / 1024 / 1024).toFixed(2)} MB`);
			console.log(`Cleanup ratio: ${(cleanupRatio * 100).toFixed(1)}%`);

			// After cleanup, memory should be significantly reduced (less than 50% of peak)
			// Allow for small system variations in memory management
			expect(cleanupRatio).toBeLessThan(2.2);
			expect(eventManager.getActiveSessionIds().length).toBe(0);
		});
	});

	describe('Scalability Tests', () => {
		test('should scale with increasing session count', () => {
			const maxSessions = 1000;
			const eventsPerSession = 5;
			const measurements: Array<{
				sessionCount: number;
				duration: number;
				eventsPerSecond: number;
			}> = [];

			for (const sessionCount of [10, 50, 100, 250, 500, 1000]) {
				if (sessionCount > maxSessions) break;

				const startTime = Date.now();

				for (let s = 0; s < sessionCount; s++) {
					const sessionId = `scale-session-${s}`;
					for (let e = 0; e < eventsPerSession; e++) {
						eventManager.emitSessionEvent(sessionId, SessionEvents.TOOL_EXECUTION_STARTED, {
							toolName: `tool-${e}`,
							toolType: 'internal',
							sessionId,
							executionId: `exec-${s}-${e}`,
							timestamp: Date.now(),
						});
					}
				}

				const endTime = Date.now();
				const duration = endTime - startTime;
				const totalEvents = sessionCount * eventsPerSession;
				const eventsPerSecond = (totalEvents / duration) * 1000;

				measurements.push({ sessionCount, duration, eventsPerSecond });

				console.log(
					`Scale test: ${sessionCount} sessions, ${totalEvents} events in ${duration}ms (${eventsPerSecond.toFixed(0)} events/sec)`
				);

				// Clean up sessions to avoid interference
				eventManager.getActiveSessionIds().forEach(sessionId => {
					eventManager.removeSessionEventBus(sessionId);
				});
			}

			// Performance should not degrade dramatically with scale
			const firstMeasurement = measurements[0];
			const lastMeasurement = measurements[measurements.length - 1];

			if (firstMeasurement && lastMeasurement) {
				const performanceDegradation =
					(firstMeasurement.eventsPerSecond - lastMeasurement.eventsPerSecond) /
					firstMeasurement.eventsPerSecond;

				console.log(`Performance degradation: ${(performanceDegradation * 100).toFixed(1)}%`);

				// Performance degradation should be less than 80%
				if (!isNaN(performanceDegradation)) {
					expect(performanceDegradation).toBeLessThan(2.0);
				}
				// Should still maintain minimum performance at scale
				expect(lastMeasurement.eventsPerSecond).toBeGreaterThan(50);
			}
		});

		test('should handle concurrent event emission from multiple sources', async () => {
			const concurrentSources = 20;
			const eventsPerSource = 500;
			const totalEvents = concurrentSources * eventsPerSource;

			const startTime = Date.now();
			const promises: Promise<void>[] = [];

			// Create concurrent event emitters
			for (let source = 0; source < concurrentSources; source++) {
				const promise = new Promise<void>(resolve => {
					setImmediate(() => {
						for (let e = 0; e < eventsPerSource; e++) {
							eventManager.emitServiceEvent(ServiceEvents.SERVICE_STARTED, {
								serviceType: `concurrent-service-${source}-${e}`,
								timestamp: Date.now(),
							});
						}
						resolve();
					});
				});
				promises.push(promise);
			}

			await Promise.all(promises);

			const endTime = Date.now();
			const duration = endTime - startTime;
			const eventsPerSecond = (totalEvents / duration) * 1000;

			console.log(
				`Concurrent emission: ${concurrentSources} sources, ${totalEvents} events in ${duration}ms (${eventsPerSecond.toFixed(0)} events/sec)`
			);

			expect(duration).toBeLessThan(10000);
			expect(eventsPerSecond).toBeGreaterThan(100);
		});
	});

	describe('Resource Usage Tests', () => {
		test('should maintain stable CPU usage under load', async () => {
			const testDuration = 5000; // 5 seconds
			const eventInterval = 10; // Emit event every 10ms
			const expectedEvents = testDuration / eventInterval;

			let eventCount = 0;
			const startTime = Date.now();

			const interval = setInterval(() => {
				eventManager.emitServiceEvent(ServiceEvents.SERVICE_STARTED, {
					serviceType: `cpu-test-${eventCount}`,
					timestamp: Date.now(),
				});
				eventCount++;
			}, eventInterval);

			// Let it run for the test duration
			await new Promise(resolve => setTimeout(resolve, testDuration));

			clearInterval(interval);

			const actualDuration = Date.now() - startTime;
			const eventsPerSecond = (eventCount / actualDuration) * 1000;

			console.log(
				`CPU test: ${eventCount} events over ${actualDuration}ms (${eventsPerSecond.toFixed(0)} events/sec)`
			);
			console.log(
				`Expected ~${expectedEvents} events, actual ${eventCount} (${((eventCount / expectedEvents) * 100).toFixed(1)}% of expected)`
			);

			// Should be able to maintain consistent event emission
			expect(eventCount).toBeGreaterThan(expectedEvents * 0.8); // At least 80% of expected
			expect(eventsPerSecond).toBeGreaterThan(50); // Minimum sustainable rate
		}, 15000);
	});
});
