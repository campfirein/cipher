/**
 * Tests for Cross-Project Knowledge Transfer Manager
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CrossProjectManager } from '../cross-project-manager.js';
import type { ProjectKnowledge, KnowledgeTransfer } from '../types.js';

describe('CrossProjectManager', () => {
	let manager: CrossProjectManager;
	let mockLogger: any;

	beforeEach(() => {
		// Mock logger
		mockLogger = {
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			debug: vi.fn(),
		};

		// Create manager with test config
		manager = new CrossProjectManager({
			enableAutoTransfer: false, // Disable for tests
			enableMasterGuide: false, // Disable for tests
			similarityThreshold: 0.7,
			maxTransferPerProject: 10,
			updateInterval: 1000,
			masterGuideUpdateInterval: 2000,
			knowledgeRetentionDays: 7,
		});
	});

	afterEach(async () => {
		if (manager.isSystemRunning()) {
			await manager.shutdown();
		}
	});

	describe('Initialization', () => {
		it('should initialize successfully', async () => {
			await expect(manager.initialize()).resolves.not.toThrow();
			expect(manager.isSystemRunning()).toBe(true);
		});

		it('should emit initialized event', async () => {
			const initPromise = new Promise(resolve => {
				manager.once('initialized', resolve);
			});

			await manager.initialize();
			await expect(initPromise).resolves.toBeDefined();
		});
	});

	describe('Project Registration', () => {
		beforeEach(async () => {
			await manager.initialize();
		});

		it('should register a project successfully', async () => {
			const project: Omit<ProjectKnowledge, 'lastUpdated' | 'knowledgeCount'> = {
				projectId: 'test-project-1',
				projectName: 'Test Project 1',
				domain: 'web-development',
				tags: ['react', 'typescript'],
				metadata: { version: '1.0.0' },
			};

			await expect(manager.registerProject(project)).resolves.not.toThrow();

			const registeredProject = manager.getProject('test-project-1');
			expect(registeredProject).toBeDefined();
			expect(registeredProject?.projectName).toBe('Test Project 1');
			expect(registeredProject?.domain).toBe('web-development');
		});

		it('should emit projectRegistered event', async () => {
			const project: Omit<ProjectKnowledge, 'lastUpdated' | 'knowledgeCount'> = {
				projectId: 'test-project-2',
				projectName: 'Test Project 2',
				domain: 'mobile-development',
				tags: ['react-native'],
				metadata: {},
			};

			const registrationPromise = new Promise(resolve => {
				manager.once('projectRegistered', resolve);
			});

			await manager.registerProject(project);
			await expect(registrationPromise).resolves.toBeDefined();
		});
	});

	describe('Knowledge Transfer', () => {
		beforeEach(async () => {
			await manager.initialize();

			// Register test projects
			await manager.registerProject({
				projectId: 'source-project',
				projectName: 'Source Project',
				domain: 'web-development',
				tags: ['react'],
				metadata: {},
			});

			await manager.registerProject({
				projectId: 'target-project',
				projectName: 'Target Project',
				domain: 'web-development',
				tags: ['vue'],
				metadata: {},
			});
		});

		it('should transfer knowledge between projects', async () => {
			const transferId = await manager.transferKnowledge(
				'source-project',
				'target-project',
				'Use React hooks for state management',
				'pattern',
				0.9,
				0.8
			);

			expect(transferId).toBeDefined();
			expect(typeof transferId).toBe('string');

			const transfers = manager.getProjectTransfers('source-project');
			expect(transfers).toHaveLength(1);
			expect(transfers[0].content).toBe('Use React hooks for state management');
			expect(transfers[0].knowledgeType).toBe('pattern');
		});

		it('should emit knowledgeTransferred event', async () => {
			const transferPromise = new Promise(resolve => {
				manager.once('knowledgeTransferred', resolve);
			});

			await manager.transferKnowledge(
				'source-project',
				'target-project',
				'Test knowledge',
				'fact',
				0.8,
				0.7
			);

			await expect(transferPromise).resolves.toBeDefined();
		});

		it('should throw error for non-existent source project', async () => {
			await expect(
				manager.transferKnowledge(
					'non-existent',
					'target-project',
					'Test knowledge',
					'fact',
					0.8,
					0.7
				)
			).rejects.toThrow('Source project non-existent not found');
		});

		it('should throw error for non-existent target project', async () => {
			await expect(
				manager.transferKnowledge(
					'source-project',
					'non-existent',
					'Test knowledge',
					'fact',
					0.8,
					0.7
				)
			).rejects.toThrow('Target project non-existent not found');
		});
	});

	describe('Master Guide Generation', () => {
		beforeEach(async () => {
			await manager.initialize();

			// Register projects for master guide generation
			await manager.registerProject({
				projectId: 'project-1',
				projectName: 'Project 1',
				domain: 'web-development',
				tags: ['react'],
				metadata: {},
			});

			await manager.registerProject({
				projectId: 'project-2',
				projectName: 'Project 2',
				domain: 'web-development',
				tags: ['vue'],
				metadata: {},
			});

			// Add some knowledge transfers
			await manager.transferKnowledge(
				'project-1',
				'project-2',
				'Use component composition for reusability',
				'pattern',
				0.9,
				0.8
			);
		});

		it('should generate master guide for domain', async () => {
			const guide = await manager.generateMasterGuide('web-development', 'Web Dev Master Guide');

			expect(guide).toBeDefined();
			expect(guide.title).toBe('Web Dev Master Guide');
			expect(guide.domain).toBe('web-development');
			expect(guide.knowledgeSources).toContain('project-1');
			expect(guide.knowledgeSources).toContain('project-2');
		});

		it('should get master guide by ID', async () => {
			const guide = await manager.generateMasterGuide('web-development');
			const retrievedGuide = manager.getMasterGuide(guide.id);

			expect(retrievedGuide).toBeDefined();
			expect(retrievedGuide?.id).toBe(guide.id);
		});

		it('should search master guides', async () => {
			await manager.generateMasterGuide('web-development', 'Web Development Guide');

			const results = manager.searchMasterGuides('Web Development');
			expect(results).toHaveLength(1);
			expect(results[0].title).toBe('Web Development Guide');
		});
	});

	describe('Knowledge Synthesis', () => {
		beforeEach(async () => {
			await manager.initialize();

			// Register projects
			await manager.registerProject({
				projectId: 'project-1',
				projectName: 'Project 1',
				domain: 'web-development',
				tags: ['react'],
				metadata: {},
			});

			await manager.registerProject({
				projectId: 'project-2',
				projectName: 'Project 2',
				domain: 'web-development',
				tags: ['vue'],
				metadata: {},
			});

			// Add knowledge transfers
			await manager.transferKnowledge(
				'project-1',
				'project-2',
				'Use TypeScript for type safety',
				'pattern',
				0.9,
				0.8
			);

			await manager.transferKnowledge(
				'project-2',
				'project-1',
				'Implement proper error handling',
				'guideline',
				0.8,
				0.7
			);
		});

		it('should synthesize knowledge across projects', async () => {
			const synthesis = await manager.synthesizeKnowledge('web-development');

			expect(synthesis).toBeDefined();
			expect(synthesis.sourceProjects).toContain('project-1');
			expect(synthesis.sourceProjects).toContain('project-2');
			expect(synthesis.confidence).toBeGreaterThan(0);
			expect(synthesis.synthesizedKnowledge).toContain('Cross-Project Knowledge Synthesis');
		});

		it('should synthesize knowledge for all domains when no domain specified', async () => {
			const synthesis = await manager.synthesizeKnowledge();

			expect(synthesis).toBeDefined();
			expect(synthesis.sourceProjects.length).toBeGreaterThan(0);
		});
	});

	describe('Metrics and Status', () => {
		beforeEach(async () => {
			await manager.initialize();
		});

		it('should return system metrics', () => {
			const metrics = manager.getMetrics();

			expect(metrics).toBeDefined();
			expect(metrics.totalProjects).toBe(0);
			expect(metrics.totalTransfers).toBe(0);
			expect(metrics.totalMasterGuides).toBe(0);
			expect(metrics.performanceMetrics).toBeDefined();
		});

		it('should return system status', () => {
			const status = manager.getSystemStatus();

			expect(status).toBeDefined();
			expect(status.isRunning).toBe(true);
			expect(status.config).toBeDefined();
			expect(status.metrics).toBeDefined();
			expect(status.guideStats).toBeDefined();
		});
	});

	describe('Project Management', () => {
		beforeEach(async () => {
			await manager.initialize();
		});

		it('should get all projects', async () => {
			await manager.registerProject({
				projectId: 'project-1',
				projectName: 'Project 1',
				domain: 'web-development',
				tags: ['react'],
				metadata: {},
			});

			const projects = manager.getAllProjects();
			expect(projects).toHaveLength(1);
			expect(projects[0].projectId).toBe('project-1');
		});

		it('should update project knowledge count', async () => {
			await manager.registerProject({
				projectId: 'project-1',
				projectName: 'Project 1',
				domain: 'web-development',
				tags: ['react'],
				metadata: {},
			});

			await manager.updateProjectKnowledge('project-1', 50, { version: '2.0.0' });

			const project = manager.getProject('project-1');
			expect(project?.knowledgeCount).toBe(50);
			expect(project?.metadata.version).toBe('2.0.0');
		});
	});

	describe('Shutdown', () => {
		beforeEach(async () => {
			await manager.initialize();
		});

		it('should shutdown gracefully', async () => {
			await expect(manager.shutdown()).resolves.not.toThrow();
			expect(manager.isSystemRunning()).toBe(false);
		});

		it('should emit shutdown event', async () => {
			const shutdownPromise = new Promise(resolve => {
				manager.once('shutdown', resolve);
			});

			await manager.shutdown();
			await expect(shutdownPromise).resolves.toBeDefined();
		});
	});
});
