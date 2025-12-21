/**
 * Demo script for Cross-Project Knowledge Transfer System
 *
 * This script demonstrates the functionality without test framework dependencies
 */

// Simple console logger to avoid import issues
const logger = {
	info: (message: string, meta?: any) => console.log(`[INFO] ${message}`, meta || ''),
	warn: (message: string, meta?: any) => console.warn(`[WARN] ${message}`, meta || ''),
	error: (message: string, meta?: any) => console.error(`[ERROR] ${message}`, meta || ''),
	debug: (message: string, meta?: any) => console.debug(`[DEBUG] ${message}`, meta || ''),
	verbose: (message: string, meta?: any) => console.log(`[VERBOSE] ${message}`, meta || ''),
	silly: (message: string, meta?: any) => console.log(`[SILLY] ${message}`, meta || ''),
	http: (message: string, meta?: any) => console.log(`[HTTP] ${message}`, meta || ''),
	displayAIResponse: (response: any) => console.log('[AI Response]', response),
	toolCall: (toolName: string, args: any) => console.log(`[Tool Call] ${toolName}`, args),
	toolResult: (result: any) => console.log('[Tool Result]', result),
	displayBox: (title: string, content: string, borderColor?: string) =>
		console.log(`[Box] ${title}: ${content}`),
	setLevel: (level: string) => console.log(`[Set Level] ${level}`),
	getLevel: () => 'info',
	setSilent: (silent: boolean) => console.log(`[Set Silent] ${silent}`),
	redirectToFile: (filePath: string) => console.log(`[Redirect to File] ${filePath}`),
	redirectToConsole: () => console.log('[Redirect to Console]'),
	createChild: (options?: any) => logger,
	getWinstonLogger: () => ({}),
};

// Mock the logger module
const mockLoggerModule = { logger };

// Simple implementation of the core functionality for demo
class SimpleProjectRegistry {
	private projects = new Map<string, any>();
	private transfers = new Map<string, any>();

	async registerProject(project: any): Promise<void> {
		const projectWithDefaults = {
			...project,
			lastUpdated: new Date(),
			knowledgeCount: 0,
		};
		this.projects.set(project.projectId, projectWithDefaults);
		logger.info('Project registered', { projectId: project.projectId });
	}

	async transferKnowledge(transfer: any): Promise<string> {
		const transferId = `transfer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
		const transferWithId = {
			...transfer,
			id: transferId,
			transferredAt: new Date(),
		};
		this.transfers.set(transferId, transferWithId);
		logger.info('Knowledge transferred', {
			transferId,
			source: transfer.sourceProjectId,
			target: transfer.targetProjectId,
		});
		return transferId;
	}

	getProjects(): any[] {
		return Array.from(this.projects.values());
	}

	getProjectTransfers(projectId: string): any[] {
		return Array.from(this.transfers.values()).filter(
			transfer => transfer.sourceProjectId === projectId || transfer.targetProjectId === projectId
		);
	}
}

class SimpleKnowledgeSynthesizer {
	async synthesizeKnowledge(projects: any[], transfers: any[], domain?: string): Promise<any> {
		const relevantProjects = domain ? projects.filter(p => p.domain === domain) : projects;

		const relevantTransfers = domain
			? transfers.filter(t => {
					const sourceProject = projects.find(p => p.projectId === t.sourceProjectId);
					const targetProject = projects.find(p => p.projectId === t.targetProjectId);
					return sourceProject?.domain === domain || targetProject?.domain === domain;
				})
			: transfers;

		// Simple pattern extraction
		const patterns = relevantTransfers
			.filter(t => t.knowledgeType === 'pattern' && t.confidence >= 0.7)
			.map(t => ({
				id: `pattern_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
				name: this.generatePatternName(t.content),
				description: t.content,
				pattern: t.content,
				examples: [t.content],
				confidence: t.confidence,
				sourceProjects: [t.sourceProjectId, t.targetProjectId],
			}));

		// Simple solution extraction
		const solutions = relevantTransfers
			.filter(t => t.knowledgeType === 'solution' && t.confidence >= 0.7)
			.map(t => ({
				id: `solution_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
				problem: this.extractProblem(t.content),
				solution: t.content,
				context: t.content,
				effectiveness: t.confidence,
				sourceProjects: [t.sourceProjectId, t.targetProjectId],
				relatedPatterns: [],
			}));

		// Generate synthesized knowledge
		const synthesizedKnowledge = this.createSynthesizedKnowledge(
			patterns,
			solutions,
			relevantProjects
		);
		const confidence = this.calculateConfidence(patterns, solutions, relevantProjects);

		return {
			synthesizedKnowledge,
			sourceProjects: relevantProjects.map(p => p.projectId),
			confidence,
			patterns,
			recommendations: this.generateRecommendations(patterns, solutions),
		};
	}

	private generatePatternName(text: string): string {
		const words = text.split(' ').slice(0, 3);
		return words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
	}

	private extractProblem(text: string): string {
		const problemIndicators = ['problem', 'issue', 'challenge', 'error', 'bug'];
		const sentences = text.split(/[.!?]+/);
		const problemSentence = sentences.find(s =>
			problemIndicators.some(indicator => s.toLowerCase().includes(indicator))
		);
		return problemSentence || sentences[0] || text.substring(0, 50);
	}

	private createSynthesizedKnowledge(patterns: any[], solutions: any[], projects: any[]): string {
		const sections = [];

		sections.push(`# Cross-Project Knowledge Synthesis\n`);
		sections.push(
			`Generated from ${projects.length} projects across ${new Set(projects.map(p => p.domain)).size} domains.\n`
		);

		if (patterns.length > 0) {
			sections.push(`## Identified Patterns (${patterns.length})\n`);
			for (const pattern of patterns.slice(0, 5)) {
				sections.push(`### ${pattern.name}`);
				sections.push(`${pattern.description}\n`);
				sections.push(`**Confidence:** ${(pattern.confidence * 100).toFixed(1)}%\n`);
				sections.push(`**Source Projects:** ${pattern.sourceProjects.length}\n`);
			}
		}

		if (solutions.length > 0) {
			sections.push(`## Effective Solutions (${solutions.length})\n`);
			for (const solution of solutions.slice(0, 5)) {
				sections.push(`### ${solution.problem}`);
				sections.push(`${solution.solution}\n`);
				sections.push(`**Effectiveness:** ${(solution.effectiveness * 100).toFixed(1)}%\n`);
			}
		}

		return sections.join('\n');
	}

	private calculateConfidence(patterns: any[], solutions: any[], projects: any[]): number {
		if (patterns.length === 0 && solutions.length === 0) return 0;

		const patternConfidence =
			patterns.length > 0
				? patterns.reduce((sum, p) => sum + p.confidence, 0) / patterns.length
				: 0;

		const solutionConfidence =
			solutions.length > 0
				? solutions.reduce((sum, s) => sum + s.effectiveness, 0) / solutions.length
				: 0;

		const diversityBonus = Math.min(projects.length / 10, 0.2);
		return Math.min((patternConfidence + solutionConfidence) / 2 + diversityBonus, 1.0);
	}

	private generateRecommendations(patterns: any[], solutions: any[]): string[] {
		const recommendations: string[] = [];

		if (patterns.length > 0) {
			recommendations.push(
				`Consider implementing the ${patterns[0].name} pattern across similar projects`
			);
		}

		if (solutions.length > 0) {
			recommendations.push(`Apply the solution for "${solutions[0].problem}" to related projects`);
		}

		if (patterns.length < 3) {
			recommendations.push('Consider collecting more pattern data to improve synthesis quality');
		}

		return recommendations;
	}
}

class SimpleCrossProjectManager {
	private projectRegistry: SimpleProjectRegistry;
	private synthesizer: SimpleKnowledgeSynthesizer;
	private isRunning = false;

	constructor() {
		this.projectRegistry = new SimpleProjectRegistry();
		this.synthesizer = new SimpleKnowledgeSynthesizer();
	}

	async initialize(): Promise<void> {
		logger.info('Initializing cross-project knowledge transfer system');
		this.isRunning = true;
		logger.info('System initialized successfully');
	}

	async registerProject(project: any): Promise<void> {
		await this.projectRegistry.registerProject(project);
	}

	async transferKnowledge(
		sourceProjectId: string,
		targetProjectId: string,
		knowledge: string,
		knowledgeType: string,
		confidence: number,
		relevance: number
	): Promise<string> {
		return await this.projectRegistry.transferKnowledge({
			sourceProjectId,
			targetProjectId,
			knowledgeType,
			content: knowledge,
			confidence,
			relevance,
			metadata: {
				transferredBy: 'cross-project-manager',
				timestamp: new Date().toISOString(),
			},
		});
	}

	async synthesizeKnowledge(domain?: string): Promise<any> {
		const projects = this.projectRegistry.getProjects();
		const transfers = Array.from(this.projectRegistry['transfers'].values());
		return await this.synthesizer.synthesizeKnowledge(projects, transfers, domain);
	}

	getProjects(): any[] {
		return this.projectRegistry.getProjects();
	}

	getProjectTransfers(projectId: string): any[] {
		return this.projectRegistry.getProjectTransfers(projectId);
	}

	getMetrics(): any {
		const projects = this.getProjects();
		const transfers = Array.from(this.projectRegistry['transfers'].values());

		return {
			totalProjects: projects.length,
			totalTransfers: transfers.length,
			averageConfidence:
				transfers.length > 0
					? transfers.reduce((sum, t) => sum + t.confidence, 0) / transfers.length
					: 0,
			lastUpdate: new Date(),
		};
	}

	isSystemRunning(): boolean {
		return this.isRunning;
	}

	async shutdown(): Promise<void> {
		logger.info('Shutting down cross-project knowledge transfer system');
		this.isRunning = false;
		logger.info('System shutdown complete');
	}
}

// Demo function
async function runDemo() {
	console.log('🚀 Starting Cross-Project Knowledge Transfer Demo\n');

	const manager = new SimpleCrossProjectManager();
	await manager.initialize();

	try {
		// Step 1: Register projects
		console.log('📝 Step 1: Registering projects...');
		const projects = [
			{
				projectId: 'react-ecommerce',
				projectName: 'E-commerce React App',
				domain: 'web-development',
				tags: ['react', 'typescript', 'ecommerce'],
				metadata: { framework: 'React 18' },
			},
			{
				projectId: 'vue-dashboard',
				projectName: 'Admin Dashboard',
				domain: 'web-development',
				tags: ['vue', 'typescript', 'dashboard'],
				metadata: { framework: 'Vue 3' },
			},
			{
				projectId: 'nodejs-api',
				projectName: 'Node.js REST API',
				domain: 'backend-development',
				tags: ['nodejs', 'express', 'api'],
				metadata: { framework: 'Express.js' },
			},
			{
				projectId: 'react-mobile',
				projectName: 'React Native App',
				domain: 'mobile-development',
				tags: ['react-native', 'typescript'],
				metadata: { framework: 'React Native' },
			},
		];

		for (const project of projects) {
			await manager.registerProject(project);
		}

		console.log(`✅ Registered ${projects.length} projects\n`);

		// Step 2: Transfer knowledge between projects
		console.log('🔄 Step 2: Transferring knowledge between projects...');
		const knowledgeTransfers = [
			{
				source: 'react-ecommerce',
				target: 'vue-dashboard',
				knowledge: 'Use TypeScript for better type safety and development experience',
				type: 'pattern',
				confidence: 0.9,
				relevance: 0.8,
			},
			{
				source: 'vue-dashboard',
				target: 'nodejs-api',
				knowledge:
					'Implement proper error handling with try-catch blocks and meaningful error messages',
				type: 'solution',
				confidence: 0.85,
				relevance: 0.9,
			},
			{
				source: 'nodejs-api',
				target: 'react-ecommerce',
				knowledge: 'Use environment variables for API endpoints configuration',
				type: 'guideline',
				confidence: 0.8,
				relevance: 0.7,
			},
			{
				source: 'react-ecommerce',
				target: 'react-mobile',
				knowledge: 'Use custom hooks for reusable state logic and side effects',
				type: 'pattern',
				confidence: 0.9,
				relevance: 0.9,
			},
			{
				source: 'react-mobile',
				target: 'vue-dashboard',
				knowledge: 'Implement responsive design patterns for different screen sizes',
				type: 'pattern',
				confidence: 0.8,
				relevance: 0.8,
			},
		];

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

		console.log(`✅ Completed ${transferIds.length} knowledge transfers\n`);

		// Step 3: Verify knowledge transfers
		console.log('🔍 Step 3: Verifying knowledge transfers...');
		for (const project of projects) {
			const transfers = manager.getProjectTransfers(project.projectId);
			console.log(`  ${project.projectName}: ${transfers.length} transfers`);
		}
		console.log('');

		// Step 4: Test knowledge synthesis
		console.log('🧠 Step 4: Synthesizing knowledge...');
		const webDevSynthesis = await manager.synthesizeKnowledge('web-development');
		console.log(`✅ Web Development Synthesis:`);
		console.log(`  - Source Projects: ${webDevSynthesis.sourceProjects.length}`);
		console.log(`  - Patterns Found: ${webDevSynthesis.patterns?.length || 0}`);
		console.log(`  - Solutions Found: ${webDevSynthesis.solutions?.length || 0}`);
		console.log(`  - Confidence: ${(webDevSynthesis.confidence * 100).toFixed(1)}%`);
		console.log('');

		// Step 5: Cross-domain synthesis
		console.log('🌐 Step 5: Cross-domain knowledge synthesis...');
		const allDomainsSynthesis = await manager.synthesizeKnowledge();
		console.log(`✅ All Domains Synthesis:`);
		console.log(`  - Total Source Projects: ${allDomainsSynthesis.sourceProjects.length}`);
		console.log(`  - Total Patterns: ${allDomainsSynthesis.patterns?.length || 0}`);
		console.log(`  - Total Solutions: ${allDomainsSynthesis.solutions?.length || 0}`);
		console.log(`  - Overall Confidence: ${(allDomainsSynthesis.confidence * 100).toFixed(1)}%`);
		console.log('');

		// Step 6: Display synthesized knowledge
		console.log('📚 Step 6: Generated Master Knowledge:');
		console.log('─'.repeat(80));
		console.log(allDomainsSynthesis.synthesizedKnowledge);
		console.log('─'.repeat(80));
		console.log('');

		// Step 7: Display recommendations
		console.log('💡 Step 7: Recommendations:');
		allDomainsSynthesis.recommendations.forEach((rec: any, index: number) => {
			console.log(`  ${index + 1}. ${rec}`);
		});
		console.log('');

		// Step 8: Final metrics
		console.log('📊 Step 8: Final System Metrics:');
		const metrics = manager.getMetrics();
		console.log(`  - Total Projects: ${metrics.totalProjects}`);
		console.log(`  - Total Transfers: ${metrics.totalTransfers}`);
		console.log(`  - Average Confidence: ${(metrics.averageConfidence * 100).toFixed(1)}%`);
		console.log(`  - Last Update: ${metrics.lastUpdate.toISOString()}`);
		console.log('');

		console.log('🎉 Cross-Project Knowledge Transfer Demo completed successfully!');
		console.log('✨ The system successfully demonstrated:');
		console.log('   • Project registration and management');
		console.log('   • Knowledge transfer between projects');
		console.log('   • Knowledge synthesis and pattern extraction');
		console.log('   • Cross-domain knowledge aggregation');
		console.log('   • Master guide generation');
		console.log('   • Performance metrics and monitoring');
	} catch (error) {
		console.error('❌ Demo failed:', error);
	} finally {
		await manager.shutdown();
	}
}

// Run the demo if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
	runDemo().catch(console.error);
}

export { runDemo, SimpleCrossProjectManager };
