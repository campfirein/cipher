/**
 * Performance and Scalability Analysis for Cross-Project Knowledge Transfer
 *
 * Comprehensive performance testing to analyze system behavior under
 * various load conditions and measure scalability characteristics.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CrossProjectManager } from '../cross-project-manager.js';
import type { ProjectKnowledge } from '../types.js';

describe('Cross-Project Knowledge Transfer Performance Analysis', () => {
	let manager: CrossProjectManager;

	beforeEach(async () => {
		manager = new CrossProjectManager({
			enableAutoTransfer: true,
			enableMasterGuide: true,
			similarityThreshold: 0.7,
			maxTransferPerProject: 1000,
			updateInterval: 60000, // 1 minute
			masterGuideUpdateInterval: 300000, // 5 minutes
			knowledgeRetentionDays: 30,
			maxConcurrentTransfers: 10,
			transferBatchSize: 50,
		});

		await manager.initialize();
	});

	afterEach(async () => {
		if (manager.isSystemRunning()) {
			await manager.shutdown();
		}
	});

	describe('Scalability Analysis', () => {
		it('should handle large number of projects efficiently', async () => {
			const projectCounts = [10, 50, 100, 200];
			const results: Array<{
				projectCount: number;
				registrationTime: number;
				memoryUsage: number;
				averageTimePerProject: number;
			}> = [];

			for (const projectCount of projectCounts) {
				const startTime = Date.now();
				const initialMemory = process.memoryUsage().heapUsed;

				// Register projects
				for (let i = 0; i < projectCount; i++) {
					await manager.registerProject({
						projectId: `perf-project-${i}`,
						projectName: `Performance Project ${i}`,
						domain: `domain-${i % 5}`, // 5 different domains
						tags: [`tag-${i % 10}`],
						metadata: { index: i, loadTest: true },
					});
				}

				const endTime = Date.now();
				const finalMemory = process.memoryUsage().heapUsed;
				const registrationTime = endTime - startTime;
				const memoryUsage = finalMemory - initialMemory;

				results.push({
					projectCount,
					registrationTime,
					memoryUsage,
					averageTimePerProject: registrationTime / projectCount,
				});

				console.log(
					`📊 Projects: ${projectCount}, Time: ${registrationTime}ms, Memory: ${(memoryUsage / 1024 / 1024).toFixed(2)}MB`
				);
			}

			// Analyze scalability trends
			const firstResult = results[0];
			const lastResult = results[results.length - 1];

			// Registration time should scale linearly or better
			const timeScalingFactor = lastResult.registrationTime / firstResult.registrationTime;
			const projectScalingFactor = lastResult.projectCount / firstResult.projectCount;
			const timeEfficiency = timeScalingFactor / projectScalingFactor;

			expect(timeEfficiency).toBeLessThan(2); // Should not scale worse than 2x
			console.log(`⚡ Time scaling efficiency: ${timeEfficiency.toFixed(2)}x`);

			// Memory usage should be reasonable
			const memoryPerProject = lastResult.memoryUsage / lastResult.projectCount;
			expect(memoryPerProject).toBeLessThan(1024 * 1024); // Less than 1MB per project
			console.log(`💾 Memory per project: ${(memoryPerProject / 1024).toFixed(2)}KB`);
		});

		it('should handle large number of knowledge transfers efficiently', async () => {
			// Register base projects
			const baseProjectCount = 20;
			for (let i = 0; i < baseProjectCount; i++) {
				await manager.registerProject({
					projectId: `transfer-project-${i}`,
					projectName: `Transfer Project ${i}`,
					domain: `domain-${i % 3}`,
					tags: [`tag-${i % 5}`],
					metadata: { index: i },
				});
			}

			const transferCounts = [100, 500, 1000, 2000];
			const results: Array<{
				transferCount: number;
				transferTime: number;
				averageTimePerTransfer: number;
				throughput: number; // transfers per second
			}> = [];

			for (const transferCount of transferCounts) {
				const startTime = Date.now();

				// Create transfers in batches to avoid overwhelming the system
				const batchSize = 50;
				const batches = Math.ceil(transferCount / batchSize);

				for (let batch = 0; batch < batches; batch++) {
					const batchStart = batch * batchSize;
					const batchEnd = Math.min(batchStart + batchSize, transferCount);
					const batchTransfers = [];

					for (let i = batchStart; i < batchEnd; i++) {
						const sourceProject = `transfer-project-${i % baseProjectCount}`;
						const targetProject = `transfer-project-${(i + 1) % baseProjectCount}`;

						batchTransfers.push(
							manager.transferKnowledge(
								sourceProject,
								targetProject,
								`Knowledge item ${i}: Pattern for problem ${i % 10}`,
								'pattern',
								0.7 + (i % 3) * 0.1,
								0.6 + (i % 4) * 0.1
							)
						);
					}

					await Promise.all(batchTransfers);
				}

				const endTime = Date.now();
				const transferTime = endTime - startTime;
				const throughput = (transferCount / transferTime) * 1000; // transfers per second

				results.push({
					transferCount,
					transferTime,
					averageTimePerTransfer: transferTime / transferCount,
					throughput,
				});

				console.log(
					`🔄 Transfers: ${transferCount}, Time: ${transferTime}ms, Throughput: ${throughput.toFixed(2)}/s`
				);
			}

			// Analyze throughput trends
			const firstResult = results[0];
			const lastResult = results[results.length - 1];

			// Throughput should remain relatively stable or improve
			const throughputRatio = lastResult.throughput / firstResult.throughput;
			expect(throughputRatio).toBeGreaterThan(0.5); // Should not degrade more than 50%
			console.log(`📈 Throughput scaling: ${throughputRatio.toFixed(2)}x`);

			// Average time per transfer should not increase significantly
			const timePerTransferRatio =
				lastResult.averageTimePerTransfer / firstResult.averageTimePerTransfer;
			expect(timePerTransferRatio).toBeLessThan(3); // Should not increase more than 3x
			console.log(`⏱️  Time per transfer scaling: ${timePerTransferRatio.toFixed(2)}x`);
		});

		it('should handle concurrent operations efficiently', async () => {
			// Register projects
			const projectCount = 50;
			for (let i = 0; i < projectCount; i++) {
				await manager.registerProject({
					projectId: `concurrent-project-${i}`,
					projectName: `Concurrent Project ${i}`,
					domain: `domain-${i % 5}`,
					tags: [`tag-${i % 3}`],
					metadata: { index: i },
				});
			}

			const concurrentOperations = 100;
			const startTime = Date.now();

			// Run concurrent operations
			const operations = Array.from({ length: concurrentOperations }, async (_, i) => {
				const operationType = i % 4;
				const projectId = `concurrent-project-${i % projectCount}`;

				switch (operationType) {
					case 0: // Knowledge transfer
						return manager.transferKnowledge(
							projectId,
							`concurrent-project-${(i + 1) % projectCount}`,
							`Concurrent knowledge ${i}`,
							'pattern',
							0.8,
							0.7
						);
					case 1: // Project knowledge update
						return manager.updateProjectKnowledge(projectId, i * 10, { concurrent: true });
					case 2: // Get project
						return manager.getProject(projectId);
					case 3: // Get project transfers
						return manager.getProjectTransfers(projectId);
				}
			});

			await Promise.all(operations);
			const endTime = Date.now();
			const totalTime = endTime - startTime;

			console.log(`⚡ Concurrent operations: ${concurrentOperations}, Time: ${totalTime}ms`);
			console.log(
				`📊 Operations per second: ${((concurrentOperations / totalTime) * 1000).toFixed(2)}`
			);

			// Should complete within reasonable time
			expect(totalTime).toBeLessThan(10000); // Less than 10 seconds
		});
	});

	describe('Memory Usage Analysis', () => {
		it('should maintain reasonable memory usage under load', async () => {
			const initialMemory = process.memoryUsage().heapUsed;
			const memorySnapshots: Array<{
				operation: string;
				memory: number;
				timestamp: number;
			}> = [];

			// Register projects
			const projectCount = 100;
			for (let i = 0; i < projectCount; i++) {
				await manager.registerProject({
					projectId: `memory-project-${i}`,
					projectName: `Memory Project ${i}`,
					domain: `domain-${i % 10}`,
					tags: [`tag-${i % 5}`],
					metadata: { index: i, testData: 'x'.repeat(1000) }, // 1KB of metadata per project
				});

				if (i % 20 === 0) {
					memorySnapshots.push({
						operation: `projects-${i}`,
						memory: process.memoryUsage().heapUsed,
						timestamp: Date.now(),
					});
				}
			}

			// Add knowledge transfers
			const transferCount = 500;
			for (let i = 0; i < transferCount; i++) {
				await manager.transferKnowledge(
					`memory-project-${i % projectCount}`,
					`memory-project-${(i + 1) % projectCount}`,
					`Memory test knowledge ${i}: ${'x'.repeat(500)}`, // 500 chars per transfer
					'pattern',
					0.8,
					0.7
				);

				if (i % 100 === 0) {
					memorySnapshots.push({
						operation: `transfers-${i}`,
						memory: process.memoryUsage().heapUsed,
						timestamp: Date.now(),
					});
				}
			}

			// Generate master guides
			const domains = Array.from(
				new Set(Array.from({ length: projectCount }, (_, i) => `domain-${i % 10}`))
			);
			for (const domain of domains) {
				await manager.generateMasterGuide(domain, `${domain} Master Guide`);
			}

			memorySnapshots.push({
				operation: 'master-guides',
				memory: process.memoryUsage().heapUsed,
				timestamp: Date.now(),
			});

			const finalMemory = process.memoryUsage().heapUsed;
			const totalMemoryIncrease = finalMemory - initialMemory;

			console.log('💾 Memory Usage Analysis:');
			memorySnapshots.forEach(snapshot => {
				const memoryIncrease = snapshot.memory - initialMemory;
				console.log(`  ${snapshot.operation}: +${(memoryIncrease / 1024 / 1024).toFixed(2)}MB`);
			});

			console.log(`📊 Total memory increase: ${(totalMemoryIncrease / 1024 / 1024).toFixed(2)}MB`);
			console.log(
				`📈 Memory per project: ${(totalMemoryIncrease / projectCount / 1024).toFixed(2)}KB`
			);
			console.log(`📈 Memory per transfer: ${(totalMemoryIncrease / transferCount).toFixed(2)}B`);

			// Memory usage should be reasonable
			expect(totalMemoryIncrease).toBeLessThan(100 * 1024 * 1024); // Less than 100MB
			expect(totalMemoryIncrease / projectCount).toBeLessThan(1024 * 1024); // Less than 1MB per project
		});
	});

	describe('Response Time Analysis', () => {
		it('should maintain consistent response times under various loads', async () => {
			// Register projects
			const projectCount = 50;
			for (let i = 0; i < projectCount; i++) {
				await manager.registerProject({
					projectId: `response-project-${i}`,
					projectName: `Response Project ${i}`,
					domain: `domain-${i % 5}`,
					tags: [`tag-${i % 3}`],
					metadata: { index: i },
				});
			}

			const responseTimeTests = [
				{
					name: 'Project Registration',
					count: 10,
					operation: async () => {
						await manager.registerProject({
							projectId: `response-test-${Date.now()}`,
							projectName: 'Response Test Project',
							domain: 'test-domain',
							tags: ['test'],
							metadata: {},
						});
					},
				},
				{
					name: 'Knowledge Transfer',
					count: 50,
					operation: async () => {
						await manager.transferKnowledge(
							`response-project-${Math.floor(Math.random() * projectCount)}`,
							`response-project-${Math.floor(Math.random() * projectCount)}`,
							'Response test knowledge',
							'pattern',
							0.8,
							0.7
						);
					},
				},
				{
					name: 'Project Retrieval',
					count: 100,
					operation: async () => {
						manager.getProject(`response-project-${Math.floor(Math.random() * projectCount)}`);
					},
				},
				{
					name: 'Master Guide Generation',
					count: 5,
					operation: async () => {
						await manager.generateMasterGuide(
							`domain-${Math.floor(Math.random() * 5)}`,
							'Response Test Guide'
						);
					},
				},
				{
					name: 'Knowledge Synthesis',
					count: 10,
					operation: async () => {
						await manager.synthesizeKnowledge();
					},
				},
			];

			const results: Array<{
				operation: string;
				count: number;
				averageTime: number;
				minTime: number;
				maxTime: number;
				p95Time: number;
			}> = [];

			for (const test of responseTimeTests) {
				const times: number[] = [];

				for (let i = 0; i < test.count; i++) {
					const startTime = Date.now();
					await test.operation();
					const endTime = Date.now();
					times.push(endTime - startTime);
				}

				times.sort((a, b) => a - b);
				const averageTime = times.reduce((sum, time) => sum + time, 0) / times.length;
				const minTime = times[0];
				const maxTime = times[times.length - 1];
				const p95Index = Math.floor(times.length * 0.95);
				const p95Time = times[p95Index];

				results.push({
					operation: test.name,
					count: test.count,
					averageTime,
					minTime,
					maxTime,
					p95Time,
				});

				console.log(
					`⏱️  ${test.name}: avg=${averageTime.toFixed(2)}ms, min=${minTime}ms, max=${maxTime}ms, p95=${p95Time}ms`
				);
			}

			// Verify response times are within acceptable limits
			for (const result of results) {
				expect(result.averageTime).toBeLessThan(1000); // Average less than 1 second
				expect(result.p95Time).toBeLessThan(2000); // 95th percentile less than 2 seconds
			}
		});
	});

	describe('System Resource Analysis', () => {
		it('should provide comprehensive system metrics', async () => {
			// Set up test data
			const projectCount = 30;
			for (let i = 0; i < projectCount; i++) {
				await manager.registerProject({
					projectId: `metrics-project-${i}`,
					projectName: `Metrics Project ${i}`,
					domain: `domain-${i % 3}`,
					tags: [`tag-${i % 2}`],
					metadata: { index: i },
				});
			}

			// Add transfers
			const transferCount = 100;
			for (let i = 0; i < transferCount; i++) {
				await manager.transferKnowledge(
					`metrics-project-${i % projectCount}`,
					`metrics-project-${(i + 1) % projectCount}`,
					`Metrics test knowledge ${i}`,
					'pattern',
					0.8,
					0.7
				);
			}

			// Generate master guides
			await manager.generateMasterGuide('domain-0', 'Domain 0 Guide');
			await manager.generateMasterGuide('domain-1', 'Domain 1 Guide');

			// Get system metrics
			const metrics = manager.getMetrics();
			const status = manager.getSystemStatus();

			console.log('📊 System Metrics:');
			console.log(`  Projects: ${metrics.totalProjects}`);
			console.log(`  Transfers: ${metrics.totalTransfers}`);
			console.log(`  Master Guides: ${metrics.totalMasterGuides}`);
			console.log(`  Average Confidence: ${(metrics.averageConfidence * 100).toFixed(1)}%`);
			console.log(`  Last Update: ${metrics.lastUpdate.toISOString()}`);

			console.log('⚡ Performance Metrics:');
			console.log(
				`  Average Transfer Time: ${metrics.performanceMetrics.averageTransferTime.toFixed(2)}ms`
			);
			console.log(
				`  Average Synthesis Time: ${metrics.performanceMetrics.averageSynthesisTime.toFixed(2)}ms`
			);
			console.log(
				`  Cache Hit Rate: ${(metrics.performanceMetrics.cacheHitRate * 100).toFixed(1)}%`
			);

			console.log('🔧 System Status:');
			console.log(`  Running: ${status.isRunning}`);
			console.log(`  Auto Transfer: ${status.config.enableAutoTransfer}`);
			console.log(`  Master Guide: ${status.config.enableMasterGuide}`);
			console.log(`  Similarity Threshold: ${status.config.similarityThreshold}`);

			// Verify metrics are reasonable
			expect(metrics.totalProjects).toBe(projectCount);
			expect(metrics.totalTransfers).toBe(transferCount);
			expect(metrics.totalMasterGuides).toBe(2);
			expect(metrics.averageConfidence).toBeGreaterThan(0);
			expect(metrics.performanceMetrics.averageTransferTime).toBeGreaterThan(0);
		});
	});
});
