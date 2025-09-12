/**
 * Demo Test for Cross-Project Knowledge Transfer
 *
 * This demo demonstrates the cross-project knowledge transfer functionality
 * with realistic scenarios and data.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CrossProjectManager } from '../cross-project-manager.js';
import type { ProjectKnowledge } from '../types.js';

describe('Cross-Project Knowledge Transfer Demo', () => {
	let manager: CrossProjectManager;

	beforeEach(async () => {
		manager = new CrossProjectManager({
			enableAutoTransfer: true,
			enableMasterGuide: true,
			similarityThreshold: 0.7,
			maxTransferPerProject: 50,
			updateInterval: 5000, // 5 seconds for demo
			masterGuideUpdateInterval: 10000, // 10 seconds for demo
			knowledgeRetentionDays: 7,
		});

		await manager.initialize();
	});

	afterEach(async () => {
		if (manager.isSystemRunning()) {
			await manager.shutdown();
		}
	});

	describe('Realistic Cross-Project Knowledge Transfer Scenario', () => {
		it('should demonstrate complete knowledge transfer workflow', async () => {
			// Step 1: Register multiple projects from different domains
			const projects: Omit<ProjectKnowledge, 'lastUpdated' | 'knowledgeCount'>[] = [
				{
					projectId: 'ecommerce-frontend',
					projectName: 'E-commerce Frontend',
					domain: 'web-development',
					tags: ['react', 'typescript', 'ecommerce'],
					metadata: {
						framework: 'React',
						language: 'TypeScript',
						industry: 'E-commerce',
					},
				},
				{
					projectId: 'ecommerce-backend',
					projectName: 'E-commerce Backend API',
					domain: 'backend-development',
					tags: ['nodejs', 'express', 'api'],
					metadata: {
						framework: 'Express.js',
						language: 'JavaScript',
						industry: 'E-commerce',
					},
				},
				{
					projectId: 'mobile-app',
					projectName: 'Mobile Shopping App',
					domain: 'mobile-development',
					tags: ['react-native', 'typescript'],
					metadata: {
						framework: 'React Native',
						language: 'TypeScript',
						industry: 'E-commerce',
					},
				},
				{
					projectId: 'admin-dashboard',
					projectName: 'Admin Dashboard',
					domain: 'web-development',
					tags: ['vue', 'typescript', 'admin'],
					metadata: {
						framework: 'Vue.js',
						language: 'TypeScript',
						industry: 'E-commerce',
					},
				},
			];

			// Register all projects
			for (const project of projects) {
				await manager.registerProject(project);
			}

			// Verify projects are registered
			const registeredProjects = manager.getAllProjects();
			expect(registeredProjects).toHaveLength(4);

			// Step 2: Simulate knowledge transfers between projects
			const knowledgeTransfers = [
				// Frontend to Backend
				{
					source: 'ecommerce-frontend',
					target: 'ecommerce-backend',
					knowledge:
						'Implement proper error handling with try-catch blocks and meaningful error messages',
					type: 'pattern' as const,
					confidence: 0.9,
					relevance: 0.8,
				},
				{
					source: 'ecommerce-frontend',
					target: 'ecommerce-backend',
					knowledge: 'Use TypeScript interfaces for API response validation',
					type: 'pattern' as const,
					confidence: 0.85,
					relevance: 0.9,
				},
				// Backend to Frontend
				{
					source: 'ecommerce-backend',
					target: 'ecommerce-frontend',
					knowledge: 'Implement proper loading states and error boundaries for API calls',
					type: 'solution' as const,
					confidence: 0.8,
					relevance: 0.85,
				},
				{
					source: 'ecommerce-backend',
					target: 'ecommerce-frontend',
					knowledge: 'Use environment variables for API endpoints configuration',
					type: 'guideline' as const,
					confidence: 0.9,
					relevance: 0.8,
				},
				// Frontend to Mobile
				{
					source: 'ecommerce-frontend',
					target: 'mobile-app',
					knowledge: 'Implement responsive design patterns for different screen sizes',
					type: 'pattern' as const,
					confidence: 0.85,
					relevance: 0.9,
				},
				{
					source: 'ecommerce-frontend',
					target: 'mobile-app',
					knowledge: 'Use custom hooks for state management and API calls',
					type: 'pattern' as const,
					confidence: 0.8,
					relevance: 0.85,
				},
				// Backend to Mobile
				{
					source: 'ecommerce-backend',
					target: 'mobile-app',
					knowledge: 'Implement proper authentication with JWT tokens',
					type: 'solution' as const,
					confidence: 0.9,
					relevance: 0.9,
				},
				// Admin Dashboard knowledge
				{
					source: 'admin-dashboard',
					target: 'ecommerce-frontend',
					knowledge: 'Use data tables with sorting, filtering, and pagination',
					type: 'pattern' as const,
					confidence: 0.8,
					relevance: 0.7,
				},
				{
					source: 'admin-dashboard',
					target: 'ecommerce-backend',
					knowledge: 'Implement role-based access control for admin operations',
					type: 'solution' as const,
					confidence: 0.9,
					relevance: 0.85,
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

			expect(transferIds).toHaveLength(knowledgeTransfers.length);

			// Step 3: Verify knowledge transfers
			for (const project of projects) {
				const transfers = manager.getProjectTransfers(project.projectId);
				expect(transfers.length).toBeGreaterThan(0);
			}

			// Step 4: Generate master guides for each domain
			const webDevGuide = await manager.generateMasterGuide(
				'web-development',
				'Web Development Master Guide'
			);
			expect(webDevGuide).toBeDefined();
			expect(webDevGuide.title).toBe('Web Development Master Guide');
			expect(webDevGuide.domain).toBe('web-development');
			expect(webDevGuide.knowledgeSources.length).toBeGreaterThan(0);

			const backendGuide = await manager.generateMasterGuide(
				'backend-development',
				'Backend Development Master Guide'
			);
			expect(backendGuide).toBeDefined();
			expect(backendGuide.domain).toBe('backend-development');

			const mobileGuide = await manager.generateMasterGuide(
				'mobile-development',
				'Mobile Development Master Guide'
			);
			expect(mobileGuide).toBeDefined();
			expect(mobileGuide.domain).toBe('mobile-development');

			// Step 5: Test knowledge synthesis
			const webDevSynthesis = await manager.synthesizeKnowledge('web-development');
			expect(webDevSynthesis).toBeDefined();
			expect(webDevSynthesis.sourceProjects.length).toBeGreaterThan(0);
			expect(webDevSynthesis.confidence).toBeGreaterThan(0);
			expect(webDevSynthesis.patterns.length).toBeGreaterThan(0);

			// Step 6: Test cross-domain synthesis
			const allDomainsSynthesis = await manager.synthesizeKnowledge();
			expect(allDomainsSynthesis).toBeDefined();
			expect(allDomainsSynthesis.sourceProjects.length).toBe(4);

			// Step 7: Test master guide search
			const searchResults = manager.searchMasterGuides('Web Development');
			expect(searchResults.length).toBeGreaterThan(0);
			expect(searchResults.some(guide => guide.title.includes('Web Development'))).toBe(true);

			// Step 8: Verify metrics
			const metrics = manager.getMetrics();
			expect(metrics.totalProjects).toBe(4);
			expect(metrics.totalTransfers).toBe(knowledgeTransfers.length);
			expect(metrics.totalMasterGuides).toBe(3);

			// Step 9: Test project knowledge updates
			await manager.updateProjectKnowledge('ecommerce-frontend', 25, {
				lastCommit: 'abc123',
				features: ['shopping-cart', 'user-auth', 'product-search'],
			});

			const updatedProject = manager.getProject('ecommerce-frontend');
			expect(updatedProject?.knowledgeCount).toBe(25);
			expect(updatedProject?.metadata.lastCommit).toBe('abc123');

			console.log('✅ Cross-project knowledge transfer demo completed successfully!');
			console.log(`📊 Final Metrics:`, {
				projects: metrics.totalProjects,
				transfers: metrics.totalTransfers,
				masterGuides: metrics.totalMasterGuides,
				averageConfidence: metrics.averageConfidence,
			});
		});
	});

	describe('Performance and Scalability Demo', () => {
		it('should handle large-scale knowledge transfer efficiently', async () => {
			const startTime = Date.now();

			// Register many projects
			const projectCount = 20;
			const projects: Omit<ProjectKnowledge, 'lastUpdated' | 'knowledgeCount'>[] = [];

			for (let i = 0; i < projectCount; i++) {
				projects.push({
					projectId: `project-${i}`,
					projectName: `Project ${i}`,
					domain: i % 2 === 0 ? 'web-development' : 'backend-development',
					tags: [`tag-${i % 5}`],
					metadata: { index: i },
				});
			}

			// Register all projects
			for (const project of projects) {
				await manager.registerProject(project);
			}

			// Create many knowledge transfers
			const transferCount = 100;
			const transferPromises: Promise<string>[] = [];

			for (let i = 0; i < transferCount; i++) {
				const sourceIndex = i % projectCount;
				const targetIndex = (i + 1) % projectCount;

				transferPromises.push(
					manager.transferKnowledge(
						`project-${sourceIndex}`,
						`project-${targetIndex}`,
						`Knowledge item ${i}: Use pattern X for problem Y`,
						'pattern',
						0.7 + (i % 3) * 0.1, // Varying confidence
						0.6 + (i % 4) * 0.1 // Varying relevance
					)
				);
			}

			// Execute all transfers
			const transferIds = await Promise.all(transferPromises);
			expect(transferIds).toHaveLength(transferCount);

			// Generate master guides for both domains
			const webGuide = await manager.generateMasterGuide('web-development');
			const backendGuide = await manager.generateMasterGuide('backend-development');

			expect(webGuide).toBeDefined();
			expect(backendGuide).toBeDefined();

			// Test synthesis performance
			const synthesisStart = Date.now();
			const synthesis = await manager.synthesizeKnowledge();
			const synthesisTime = Date.now() - synthesisStart;

			expect(synthesis).toBeDefined();
			expect(synthesisTime).toBeLessThan(5000); // Should complete within 5 seconds

			const totalTime = Date.now() - startTime;
			const metrics = manager.getMetrics();

			console.log('🚀 Performance Demo Results:');
			console.log(`⏱️  Total time: ${totalTime}ms`);
			console.log(`📊 Projects: ${metrics.totalProjects}`);
			console.log(`🔄 Transfers: ${metrics.totalTransfers}`);
			console.log(`📚 Master Guides: ${metrics.totalMasterGuides}`);
			console.log(`⚡ Synthesis time: ${synthesisTime}ms`);
			console.log(`📈 Average confidence: ${(metrics.averageConfidence * 100).toFixed(1)}%`);

			// Performance assertions
			expect(totalTime).toBeLessThan(10000); // Should complete within 10 seconds
			expect(metrics.totalProjects).toBe(projectCount);
			expect(metrics.totalTransfers).toBe(transferCount);
			expect(metrics.totalMasterGuides).toBe(2);
		});
	});

	describe('Error Handling and Edge Cases Demo', () => {
		it('should handle various error scenarios gracefully', async () => {
			// Test non-existent project transfers
			await expect(
				manager.transferKnowledge(
					'non-existent-source',
					'non-existent-target',
					'Test knowledge',
					'fact',
					0.8,
					0.7
				)
			).rejects.toThrow();

			// Test master guide generation with insufficient projects
			await expect(manager.generateMasterGuide('empty-domain')).rejects.toThrow(
				'Insufficient projects'
			);

			// Test with empty knowledge transfers
			await manager.registerProject({
				projectId: 'test-project',
				projectName: 'Test Project',
				domain: 'test-domain',
				tags: ['test'],
				metadata: {},
			});

			const emptySynthesis = await manager.synthesizeKnowledge('test-domain');
			expect(emptySynthesis).toBeDefined();
			expect(emptySynthesis.confidence).toBe(0);

			console.log('✅ Error handling demo completed successfully!');
		});
	});
});
