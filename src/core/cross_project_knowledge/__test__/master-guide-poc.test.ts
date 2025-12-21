/**
 * Master Guide Proof of Concept
 *
 * Demonstrates the "master guide" functionality with realistic scenarios
 * showing how knowledge from multiple projects is aggregated into
 * comprehensive, actionable guides.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CrossProjectManager } from '../cross-project-manager.js';
import type { ProjectKnowledge } from '../types.js';

describe('Master Guide Proof of Concept', () => {
	let manager: CrossProjectManager;

	beforeEach(async () => {
		manager = new CrossProjectManager({
			enableAutoTransfer: true,
			enableMasterGuide: true,
			similarityThreshold: 0.7,
			maxTransferPerProject: 100,
			updateInterval: 1000,
			masterGuideUpdateInterval: 2000,
			knowledgeRetentionDays: 30,
		});

		await manager.initialize();
	});

	afterEach(async () => {
		if (manager.isSystemRunning()) {
			await manager.shutdown();
		}
	});

	describe('React Development Master Guide Generation', () => {
		it('should create comprehensive React development master guide', async () => {
			// Register multiple React projects with different focuses
			const reactProjects: Omit<ProjectKnowledge, 'lastUpdated' | 'knowledgeCount'>[] = [
				{
					projectId: 'react-ecommerce',
					projectName: 'E-commerce React App',
					domain: 'react-development',
					tags: ['react', 'typescript', 'ecommerce', 'redux'],
					metadata: {
						framework: 'React 18',
						stateManagement: 'Redux Toolkit',
						styling: 'Styled Components',
						testing: 'Jest + React Testing Library',
					},
				},
				{
					projectId: 'react-dashboard',
					projectName: 'Admin Dashboard',
					domain: 'react-development',
					tags: ['react', 'typescript', 'dashboard', 'antd'],
					metadata: {
						framework: 'React 18',
						stateManagement: 'Context API',
						styling: 'Ant Design',
						testing: 'Jest + Enzyme',
					},
				},
				{
					projectId: 'react-mobile',
					projectName: 'React Native App',
					domain: 'react-development',
					tags: ['react-native', 'typescript', 'mobile'],
					metadata: {
						framework: 'React Native',
						stateManagement: 'Zustand',
						styling: 'NativeWind',
						testing: 'Jest + Detox',
					},
				},
				{
					projectId: 'react-microfrontend',
					projectName: 'Micro-frontend Shell',
					domain: 'react-development',
					tags: ['react', 'microfrontend', 'module-federation'],
					metadata: {
						framework: 'React 18',
						architecture: 'Micro-frontend',
						bundler: 'Webpack 5',
						moduleSystem: 'Module Federation',
					},
				},
			];

			// Register all projects
			for (const project of reactProjects) {
				await manager.registerProject(project);
			}

			// Simulate knowledge transfers between React projects
			const reactKnowledgeTransfers = [
				// State Management Patterns
				{
					source: 'react-ecommerce',
					target: 'react-dashboard',
					knowledge: 'Use Redux Toolkit with RTK Query for server state management and caching',
					type: 'pattern' as const,
					confidence: 0.95,
					relevance: 0.9,
				},
				{
					source: 'react-dashboard',
					target: 'react-ecommerce',
					knowledge: 'Implement custom hooks for complex state logic and side effects',
					type: 'pattern' as const,
					confidence: 0.9,
					relevance: 0.85,
				},
				{
					source: 'react-mobile',
					target: 'react-ecommerce',
					knowledge: 'Use Zustand for lightweight state management in smaller applications',
					type: 'pattern' as const,
					confidence: 0.85,
					relevance: 0.8,
				},
				// Component Architecture
				{
					source: 'react-ecommerce',
					target: 'react-dashboard',
					knowledge: 'Implement compound component pattern for reusable UI components',
					type: 'pattern' as const,
					confidence: 0.9,
					relevance: 0.9,
				},
				{
					source: 'react-dashboard',
					target: 'react-microfrontend',
					knowledge: 'Use render props pattern for cross-microfrontend component sharing',
					type: 'pattern' as const,
					confidence: 0.8,
					relevance: 0.85,
				},
				// Performance Optimization
				{
					source: 'react-ecommerce',
					target: 'react-dashboard',
					knowledge: 'Implement React.memo and useMemo for expensive component re-renders',
					type: 'solution' as const,
					confidence: 0.9,
					relevance: 0.9,
				},
				{
					source: 'react-mobile',
					target: 'react-ecommerce',
					knowledge: 'Use React.lazy and Suspense for code splitting and lazy loading',
					type: 'solution' as const,
					confidence: 0.85,
					relevance: 0.8,
				},
				// Testing Strategies
				{
					source: 'react-dashboard',
					target: 'react-ecommerce',
					knowledge: 'Write integration tests with React Testing Library focusing on user behavior',
					type: 'guideline' as const,
					confidence: 0.9,
					relevance: 0.9,
				},
				{
					source: 'react-mobile',
					target: 'react-dashboard',
					knowledge: 'Use Detox for end-to-end testing in React Native applications',
					type: 'guideline' as const,
					confidence: 0.85,
					relevance: 0.7,
				},
				// Error Handling
				{
					source: 'react-ecommerce',
					target: 'react-dashboard',
					knowledge: 'Implement error boundaries with fallback UI for graceful error handling',
					type: 'solution' as const,
					confidence: 0.95,
					relevance: 0.9,
				},
				{
					source: 'react-microfrontend',
					target: 'react-ecommerce',
					knowledge: 'Use React Error Boundary with retry mechanism for microfrontend failures',
					type: 'solution' as const,
					confidence: 0.8,
					relevance: 0.75,
				},
				// Styling and UI
				{
					source: 'react-dashboard',
					target: 'react-ecommerce',
					knowledge: 'Use CSS-in-JS with styled-components for component-scoped styling',
					type: 'pattern' as const,
					confidence: 0.85,
					relevance: 0.8,
				},
				{
					source: 'react-mobile',
					target: 'react-dashboard',
					knowledge: 'Implement responsive design with CSS Grid and Flexbox',
					type: 'pattern' as const,
					confidence: 0.8,
					relevance: 0.7,
				},
			];

			// Execute knowledge transfers
			for (const transfer of reactKnowledgeTransfers) {
				await manager.transferKnowledge(
					transfer.source,
					transfer.target,
					transfer.knowledge,
					transfer.type,
					transfer.confidence,
					transfer.relevance
				);
			}

			// Generate React Development Master Guide
			const masterGuide = await manager.generateMasterGuide(
				'react-development',
				'React Development Master Guide'
			);

			// Verify master guide properties
			expect(masterGuide).toBeDefined();
			expect(masterGuide.title).toBe('React Development Master Guide');
			expect(masterGuide.domain).toBe('react-development');
			expect(masterGuide.knowledgeSources).toHaveLength(4);
			expect(masterGuide.knowledgeSources).toContain('react-ecommerce');
			expect(masterGuide.knowledgeSources).toContain('react-dashboard');
			expect(masterGuide.knowledgeSources).toContain('react-mobile');
			expect(masterGuide.knowledgeSources).toContain('react-microfrontend');

			// Verify master guide content structure
			expect(masterGuide.content).toContain('Cross-Project Knowledge Synthesis');
			expect(masterGuide.content).toContain('4 projects');
			expect(masterGuide.content).toContain('Identified Patterns');
			expect(masterGuide.content).toContain('Effective Solutions');
			expect(masterGuide.content).toContain('Guidelines');

			// Verify patterns are extracted
			expect(masterGuide.patterns).toBeDefined();
			expect(masterGuide.patterns.length).toBeGreaterThan(0);

			// Check for specific patterns
			const patternNames = masterGuide.patterns.map(p => p.name);
			expect(
				patternNames.some(
					name =>
						name.toLowerCase().includes('redux') ||
						name.toLowerCase().includes('hook') ||
						name.toLowerCase().includes('component')
				)
			).toBe(true);

			// Verify solutions are generated
			expect(masterGuide.solutions).toBeDefined();
			expect(masterGuide.solutions.length).toBeGreaterThan(0);

			// Verify guidelines are created
			expect(masterGuide.guidelines).toBeDefined();
			expect(masterGuide.guidelines.length).toBeGreaterThan(0);

			// Test master guide search functionality
			const searchResults = manager.searchMasterGuides('React Development');
			expect(searchResults).toHaveLength(1);
			expect(searchResults[0].id).toBe(masterGuide.id);

			// Test domain-specific search
			const domainGuides = manager.getMasterGuidesByDomain('react-development');
			expect(domainGuides).toHaveLength(1);
			expect(domainGuides[0].id).toBe(masterGuide.id);

			console.log('📚 React Development Master Guide Generated:');
			console.log(`📖 Title: ${masterGuide.title}`);
			console.log(`🏷️  Domain: ${masterGuide.domain}`);
			console.log(`📊 Knowledge Sources: ${masterGuide.knowledgeSources.length}`);
			console.log(`🔍 Patterns Identified: ${masterGuide.patterns.length}`);
			console.log(`💡 Solutions Found: ${masterGuide.solutions.length}`);
			console.log(`📋 Guidelines Created: ${masterGuide.guidelines.length}`);
			console.log(`📝 Content Length: ${masterGuide.content.length} characters`);
		});
	});

	describe('Multi-Domain Master Guide Generation', () => {
		it('should create master guides for different domains', async () => {
			// Register projects from different domains
			const multiDomainProjects: Omit<ProjectKnowledge, 'lastUpdated' | 'knowledgeCount'>[] = [
				// Frontend projects
				{
					projectId: 'vue-spa',
					projectName: 'Vue SPA Application',
					domain: 'frontend-development',
					tags: ['vue', 'typescript', 'spa'],
					metadata: { framework: 'Vue 3', language: 'TypeScript' },
				},
				{
					projectId: 'angular-enterprise',
					projectName: 'Angular Enterprise App',
					domain: 'frontend-development',
					tags: ['angular', 'typescript', 'enterprise'],
					metadata: { framework: 'Angular 15', language: 'TypeScript' },
				},
				// Backend projects
				{
					projectId: 'nodejs-api',
					projectName: 'Node.js REST API',
					domain: 'backend-development',
					tags: ['nodejs', 'express', 'api'],
					metadata: { framework: 'Express.js', language: 'JavaScript' },
				},
				{
					projectId: 'python-django',
					projectName: 'Django Web Application',
					domain: 'backend-development',
					tags: ['python', 'django', 'web'],
					metadata: { framework: 'Django', language: 'Python' },
				},
				// Mobile projects
				{
					projectId: 'flutter-app',
					projectName: 'Flutter Mobile App',
					domain: 'mobile-development',
					tags: ['flutter', 'dart', 'mobile'],
					metadata: { framework: 'Flutter', language: 'Dart' },
				},
				{
					projectId: 'swift-ios',
					projectName: 'iOS Native App',
					domain: 'mobile-development',
					tags: ['swift', 'ios', 'native'],
					metadata: { framework: 'SwiftUI', language: 'Swift' },
				},
			];

			// Register all projects
			for (const project of multiDomainProjects) {
				await manager.registerProject(project);
			}

			// Add cross-domain knowledge transfers
			const crossDomainTransfers = [
				// Frontend to Backend
				{
					source: 'vue-spa',
					target: 'nodejs-api',
					knowledge: 'Implement CORS middleware for cross-origin requests',
					type: 'solution' as const,
					confidence: 0.9,
					relevance: 0.9,
				},
				{
					source: 'angular-enterprise',
					target: 'python-django',
					knowledge: 'Use JWT tokens for stateless authentication',
					type: 'pattern' as const,
					confidence: 0.85,
					relevance: 0.8,
				},
				// Backend to Frontend
				{
					source: 'nodejs-api',
					target: 'vue-spa',
					knowledge: 'Implement proper error handling with try-catch and user-friendly messages',
					type: 'guideline' as const,
					confidence: 0.9,
					relevance: 0.85,
				},
				{
					source: 'python-django',
					target: 'angular-enterprise',
					knowledge: 'Use Django REST Framework serializers for API response validation',
					type: 'pattern' as const,
					confidence: 0.8,
					relevance: 0.8,
				},
				// Mobile to Backend
				{
					source: 'flutter-app',
					target: 'nodejs-api',
					knowledge: 'Implement offline-first architecture with local data synchronization',
					type: 'pattern' as const,
					confidence: 0.85,
					relevance: 0.9,
				},
				{
					source: 'swift-ios',
					target: 'python-django',
					knowledge: 'Use push notifications for real-time updates',
					type: 'solution' as const,
					confidence: 0.8,
					relevance: 0.75,
				},
			];

			// Execute transfers
			for (const transfer of crossDomainTransfers) {
				await manager.transferKnowledge(
					transfer.source,
					transfer.target,
					transfer.knowledge,
					transfer.type,
					transfer.confidence,
					transfer.relevance
				);
			}

			// Generate master guides for each domain
			const frontendGuide = await manager.generateMasterGuide(
				'frontend-development',
				'Frontend Development Master Guide'
			);
			const backendGuide = await manager.generateMasterGuide(
				'backend-development',
				'Backend Development Master Guide'
			);
			const mobileGuide = await manager.generateMasterGuide(
				'mobile-development',
				'Mobile Development Master Guide'
			);

			// Verify all guides are created
			expect(frontendGuide).toBeDefined();
			expect(backendGuide).toBeDefined();
			expect(mobileGuide).toBeDefined();

			// Verify domain-specific content
			expect(frontendGuide.domain).toBe('frontend-development');
			expect(backendGuide.domain).toBe('backend-development');
			expect(mobileGuide.domain).toBe('mobile-development');

			// Test cross-domain synthesis
			const allDomainsSynthesis = await manager.synthesizeKnowledge();
			expect(allDomainsSynthesis).toBeDefined();
			expect(allDomainsSynthesis.sourceProjects).toHaveLength(6);

			// Test master guide search across domains
			const allGuides = manager.getAllMasterGuides();
			expect(allGuides).toHaveLength(3);

			const developmentGuides = manager.searchMasterGuides('Development');
			expect(developmentGuides).toHaveLength(3);

			console.log('🌐 Multi-Domain Master Guides Generated:');
			console.log(
				`📱 Frontend Guide: ${frontendGuide.title} (${frontendGuide.knowledgeSources.length} sources)`
			);
			console.log(
				`⚙️  Backend Guide: ${backendGuide.title} (${backendGuide.knowledgeSources.length} sources)`
			);
			console.log(
				`📱 Mobile Guide: ${mobileGuide.title} (${mobileGuide.knowledgeSources.length} sources)`
			);
			console.log(
				`🔄 Cross-domain synthesis: ${allDomainsSynthesis.patterns.length} patterns identified`
			);
		});
	});

	describe('Master Guide Versioning and Updates', () => {
		it('should demonstrate master guide versioning and updates', async () => {
			// Create a separate manager with auto-updates disabled for this test
			const versioningManager = new CrossProjectManager({
				enableAutoTransfer: false,
				enableMasterGuide: false,
				similarityThreshold: 0.7,
				maxTransferPerProject: 100,
				updateInterval: 1000,
				masterGuideUpdateInterval: 2000,
				knowledgeRetentionDays: 30,
			});
			await versioningManager.initialize();

			// Register initial projects
			await versioningManager.registerProject({
				projectId: 'project-v1',
				projectName: 'Project Version 1',
				domain: 'test-domain',
				tags: ['initial'],
				metadata: { version: '1.0.0' },
			});

			// Add initial knowledge
			await versioningManager.transferKnowledge(
				'project-v1',
				'project-v1',
				'Initial knowledge pattern',
				'pattern',
				0.8,
				0.8
			);

			// Generate initial master guide
			const initialGuide = await versioningManager.generateMasterGuide('test-domain', 'Test Master Guide');
			expect(initialGuide.version).toBe('1.0.0');

			// Add new project with additional knowledge
			await versioningManager.registerProject({
				projectId: 'project-v2',
				projectName: 'Project Version 2',
				domain: 'test-domain',
				tags: ['updated'],
				metadata: { version: '2.0.0' },
			});

			// Add new knowledge transfers
			await versioningManager.transferKnowledge(
				'project-v2',
				'project-v1',
				'Updated knowledge pattern with improvements',
				'pattern',
				0.9,
				0.9
			);

			await versioningManager.transferKnowledge(
				'project-v1',
				'project-v2',
				'New solution for common problem',
				'solution',
				0.85,
				0.8
			);

			// Update the master guide
			const updatedGuide = await versioningManager.updateMasterGuide(
				initialGuide.id,
				versioningManager.getAllProjects(),
				versioningManager.getProjectTransfers('project-v1').concat(versioningManager.getProjectTransfers('project-v2'))
			);

			// Verify version increment (versioning enabled, should increment from 1.0.0 to 1.0.1)
			expect(updatedGuide.version).toBe('1.0.1');
			expect(updatedGuide.knowledgeSources).toHaveLength(2);
			expect(updatedGuide.knowledgeSources).toContain('project-v1');
			expect(updatedGuide.knowledgeSources).toContain('project-v2');

			// Verify content updates
			expect(updatedGuide.content).toContain('2 projects');
			expect(updatedGuide.patterns.length).toBeGreaterThan(initialGuide.patterns.length);

			console.log('🔄 Master Guide Versioning Demo:');
			console.log(`📖 Initial Version: ${initialGuide.version}`);
			console.log(`📖 Updated Version: ${updatedGuide.version}`);
			console.log(
				`📊 Knowledge Sources: ${initialGuide.knowledgeSources.length} → ${updatedGuide.knowledgeSources.length}`
			);
			console.log(`🔍 Patterns: ${initialGuide.patterns.length} → ${updatedGuide.patterns.length}`);

			// Cleanup
			await versioningManager.shutdown();
		});
	});
});
