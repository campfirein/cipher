/**
 * Working Demo for Cross-Project Knowledge Transfer
 *
 * This demo shows the cross-project knowledge transfer functionality
 * using mock logger to avoid import issues.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mock the logger before importing our modules
vi.mock('../../logger/index.js', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
		verbose: vi.fn(),
		silly: vi.fn(),
		http: vi.fn(),
		displayAIResponse: vi.fn(),
		toolCall: vi.fn(),
		toolResult: vi.fn(),
		displayBox: vi.fn(),
		setLevel: vi.fn(),
		getLevel: () => 'info',
		setSilent: vi.fn(),
		redirectToFile: vi.fn(),
		redirectToConsole: vi.fn(),
		createChild: vi.fn(() => ({
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			debug: vi.fn(),
			verbose: vi.fn(),
			silly: vi.fn(),
			http: vi.fn(),
			displayAIResponse: vi.fn(),
			toolCall: vi.fn(),
			toolResult: vi.fn(),
			displayBox: vi.fn(),
			setLevel: vi.fn(),
			getLevel: () => 'info',
			setSilent: vi.fn(),
			redirectToFile: vi.fn(),
			redirectToConsole: vi.fn(),
			createChild: vi.fn(),
			getWinstonLogger: () => ({}),
		})),
		getWinstonLogger: () => ({}),
	},
}));

// Now import our modules
import { CrossProjectManager } from '../cross-project-manager.js';
import type { ProjectKnowledge } from '../types.js';

describe('Cross-Project Knowledge Transfer - Working Demo', () => {
	let manager: CrossProjectManager;

	beforeEach(async () => {
		manager = new CrossProjectManager({
			enableAutoTransfer: false, // Disable for tests
			enableMasterGuide: false, // Disable for tests
			similarityThreshold: 0.7,
			maxTransferPerProject: 10,
			updateInterval: 1000,
			masterGuideUpdateInterval: 2000,
			knowledgeRetentionDays: 7,
		});

		await manager.initialize();
	});

	afterEach(async () => {
		if (manager.isSystemRunning()) {
			await manager.shutdown();
		}
	});

	describe('Basic Functionality Demo', () => {
		it('should demonstrate project registration and knowledge transfer', async () => {
			// Step 1: Register projects
			const projects: Omit<ProjectKnowledge, 'lastUpdated' | 'knowledgeCount'>[] = [
				{
					projectId: 'react-frontend',
					projectName: 'React Frontend App',
					domain: 'web-development',
					tags: ['react', 'typescript'],
					metadata: { framework: 'React 18' },
				},
				{
					projectId: 'vue-dashboard',
					projectName: 'Vue Dashboard',
					domain: 'web-development',
					tags: ['vue', 'typescript'],
					metadata: { framework: 'Vue 3' },
				},
				{
					projectId: 'nodejs-api',
					projectName: 'Node.js API',
					domain: 'backend-development',
					tags: ['nodejs', 'express'],
					metadata: { framework: 'Express.js' },
				},
			];

			// Register all projects
			for (const project of projects) {
				await manager.registerProject(project);
			}

			// Verify projects are registered
			const registeredProjects = manager.getAllProjects();
			expect(registeredProjects).toHaveLength(3);
			expect(registeredProjects.map(p => p.projectId)).toContain('react-frontend');
			expect(registeredProjects.map(p => p.projectId)).toContain('vue-dashboard');
			expect(registeredProjects.map(p => p.projectId)).toContain('nodejs-api');

			// Step 2: Transfer knowledge between projects
			const knowledgeTransfers = [
				{
					source: 'react-frontend',
					target: 'vue-dashboard',
					knowledge: 'Use TypeScript for better type safety and development experience',
					type: 'pattern' as const,
					confidence: 0.9,
					relevance: 0.8,
				},
				{
					source: 'vue-dashboard',
					target: 'nodejs-api',
					knowledge: 'Implement proper error handling with try-catch blocks',
					type: 'solution' as const,
					confidence: 0.85,
					relevance: 0.9,
				},
				{
					source: 'nodejs-api',
					target: 'react-frontend',
					knowledge: 'Use environment variables for configuration management',
					type: 'guideline' as const,
					confidence: 0.8,
					relevance: 0.7,
				},
			];

			// Execute knowledge transfers
			const transferIds: string[] = [];
			for (const transfer of knowledgeTransfers) {
				const transferId = await manager.transferKnowledge(
					transfer.source,
					transfer.target,
					transfer.knowledge,
					transfer.type,
					transfer.confidence,
					transfer.relevance
				);
				transferIds.push(transferId);
			}

			expect(transferIds).toHaveLength(3);

			// Step 3: Verify knowledge transfers
			for (const project of projects) {
				const transfers = manager.getProjectTransfers(project.projectId);
				expect(transfers.length).toBeGreaterThan(0);
			}

			// Step 4: Test knowledge synthesis
			const synthesis = await manager.synthesizeKnowledge('web-development');
			expect(synthesis).toBeDefined();
			expect(synthesis.sourceProjects).toContain('react-frontend');
			expect(synthesis.sourceProjects).toContain('vue-dashboard');
			expect(synthesis.confidence).toBeGreaterThan(0);

			// Step 5: Test cross-domain synthesis
			const allDomainsSynthesis = await manager.synthesizeKnowledge();
			expect(allDomainsSynthesis).toBeDefined();
			expect(allDomainsSynthesis.sourceProjects).toHaveLength(3);

			// Step 6: Verify metrics
			const metrics = manager.getMetrics();
			expect(metrics.totalProjects).toBe(3);
			expect(metrics.totalTransfers).toBe(3);

			console.log('✅ Cross-project knowledge transfer demo completed successfully!');
			console.log(`📊 Final Metrics:`, {
				projects: metrics.totalProjects,
				transfers: metrics.totalTransfers,
				averageConfidence: metrics.averageConfidence,
			});
		});

		it('should demonstrate master guide generation', async () => {
			// Register projects for master guide
			await manager.registerProject({
				projectId: 'project-1',
				projectName: 'Project 1',
				domain: 'react-development',
				tags: ['react'],
				metadata: {},
			});

			await manager.registerProject({
				projectId: 'project-2',
				projectName: 'Project 2',
				domain: 'react-development',
				tags: ['react'],
				metadata: {},
			});

			// Add knowledge transfers
			await manager.transferKnowledge(
				'project-1',
				'project-2',
				'Use React hooks for state management',
				'pattern',
				0.9,
				0.8
			);

			await manager.transferKnowledge(
				'project-2',
				'project-1',
				'Implement error boundaries for error handling',
				'solution',
				0.8,
				0.9
			);

			// Generate master guide
			const guide = await manager.generateMasterGuide(
				'react-development',
				'React Development Master Guide'
			);

			expect(guide).toBeDefined();
			expect(guide.title).toBe('React Development Master Guide');
			expect(guide.domain).toBe('react-development');
			expect(guide.knowledgeSources).toHaveLength(2);
			expect(guide.content).toContain('Cross-Project Knowledge Synthesis');

			console.log('📚 Master Guide Generated:');
			console.log(`📖 Title: ${guide.title}`);
			console.log(`🏷️  Domain: ${guide.domain}`);
			console.log(`📊 Knowledge Sources: ${guide.knowledgeSources.length}`);
			console.log(`🔍 Patterns: ${guide.patterns.length}`);
			console.log(`💡 Solutions: ${guide.solutions.length}`);
		});

		it('should demonstrate performance characteristics', async () => {
			const startTime = Date.now();

			// Register multiple projects
			const projectCount = 20;
			for (let i = 0; i < projectCount; i++) {
				await manager.registerProject({
					projectId: `perf-project-${i}`,
					projectName: `Performance Project ${i}`,
					domain: `domain-${i % 3}`,
					tags: [`tag-${i % 2}`],
					metadata: { index: i },
				});
			}

			// Add knowledge transfers
			const transferCount = 50;
			for (let i = 0; i < transferCount; i++) {
				await manager.transferKnowledge(
					`perf-project-${i % projectCount}`,
					`perf-project-${(i + 1) % projectCount}`,
					`Performance test knowledge ${i}`,
					'pattern',
					0.7 + (i % 3) * 0.1,
					0.6 + (i % 4) * 0.1
				);
			}

			const endTime = Date.now();
			const totalTime = endTime - startTime;

			const metrics = manager.getMetrics();

			console.log('🚀 Performance Demo Results:');
			console.log(`⏱️  Total time: ${totalTime}ms`);
			console.log(`📊 Projects: ${metrics.totalProjects}`);
			console.log(`🔄 Transfers: ${metrics.totalTransfers}`);
			console.log(`📈 Average confidence: ${(metrics.averageConfidence * 100).toFixed(1)}%`);

			// Performance assertions
			expect(totalTime).toBeLessThan(5000); // Should complete within 5 seconds
			expect(metrics.totalProjects).toBe(projectCount);
			expect(metrics.totalTransfers).toBe(transferCount);
		});
	});
});
