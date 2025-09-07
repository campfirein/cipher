/**
 * Knowledge Synthesizer for Cross-Project Knowledge Transfer
 *
 * Analyzes knowledge from multiple projects and synthesizes insights,
 * patterns, and master guides.
 */

import { logger } from '../index.js';
import type {
	ProjectKnowledge,
	KnowledgeTransfer,
	MasterGuide,
	KnowledgeSynthesisResult,
	KnowledgePattern,
	KnowledgeSolution,
	KnowledgeGuideline,
} from './types.js';

export interface SynthesisOptions {
	minConfidence: number;
	minRelevance: number;
	maxPatterns: number;
	maxSolutions: number;
	enablePatternDetection: boolean;
	enableSolutionExtraction: boolean;
	enableGuidelineGeneration: boolean;
}

export class KnowledgeSynthesizer {
	private options: SynthesisOptions;

	constructor(options: Partial<SynthesisOptions> = {}) {
		this.options = {
			minConfidence: 0.7,
			minRelevance: 0.6,
			maxPatterns: 10,
			maxSolutions: 15,
			enablePatternDetection: true,
			enableSolutionExtraction: true,
			enableGuidelineGeneration: true,
			...options,
		};
	}

	/**
	 * Synthesize knowledge from multiple projects
	 */
	async synthesizeKnowledge(
		projects: ProjectKnowledge[],
		transfers: KnowledgeTransfer[],
		domain?: string
	): Promise<KnowledgeSynthesisResult> {
		const startTime = Date.now();

		try {
			logger.info('Starting knowledge synthesis', {
				projectCount: projects.length,
				transferCount: transfers.length,
				domain: domain || 'all',
			});

			// Filter by domain if specified
			const relevantProjects = domain ? projects.filter(p => p.domain === domain) : projects;

			const relevantTransfers = domain
				? transfers.filter(t => {
						const sourceProject = projects.find(p => p.projectId === t.sourceProjectId);
						const targetProject = projects.find(p => p.projectId === t.targetProjectId);
						return sourceProject?.domain === domain || targetProject?.domain === domain;
					})
				: transfers;

			// Extract patterns if enabled
			const patterns = this.options.enablePatternDetection
				? await this.extractPatterns(relevantProjects, relevantTransfers)
				: [];

			// Extract solutions if enabled
			const solutions = this.options.enableSolutionExtraction
				? await this.extractSolutions(relevantProjects, relevantTransfers)
				: [];

			// Generate guidelines if enabled
			const guidelines = this.options.enableGuidelineGeneration
				? await this.generateGuidelines(patterns, solutions, relevantProjects)
				: [];

			// Synthesize overall knowledge
			const synthesizedKnowledge = await this.createSynthesizedKnowledge(
				patterns,
				solutions,
				guidelines,
				relevantProjects
			);

			// Calculate confidence based on source diversity and quality
			const confidence = this.calculateConfidence(patterns, solutions, relevantProjects);

			// Generate recommendations
			const recommendations = this.generateRecommendations(patterns, solutions, guidelines);

			const result: KnowledgeSynthesisResult = {
				synthesizedKnowledge,
				sourceProjects: relevantProjects.map(p => p.projectId),
				confidence,
				patterns: patterns.slice(0, this.options.maxPatterns),
				recommendations,
			};

			const synthesisTime = Date.now() - startTime;
			logger.info('Knowledge synthesis completed', {
				synthesisTime,
				patternsFound: patterns.length,
				solutionsFound: solutions.length,
				guidelinesGenerated: guidelines.length,
				confidence,
			});

			return result;
		} catch (error) {
			logger.error('Knowledge synthesis failed', {
				error: error instanceof Error ? error.message : 'Unknown error',
			});
			throw error;
		}
	}

	/**
	 * Extract patterns from project knowledge and transfers
	 */
	private async extractPatterns(
		projects: ProjectKnowledge[],
		transfers: KnowledgeTransfer[]
	): Promise<KnowledgePattern[]> {
		const patterns: KnowledgePattern[] = [];
		const patternMap = new Map<
			string,
			{
				count: number;
				examples: string[];
				sourceProjects: Set<string>;
				confidence: number;
			}
		>();

		// Analyze transfers for patterns
		for (const transfer of transfers) {
			if (
				transfer.knowledgeType === 'pattern' &&
				transfer.confidence >= this.options.minConfidence
			) {
				const key = this.normalizePattern(transfer.content);
				if (!patternMap.has(key)) {
					patternMap.set(key, {
						count: 0,
						examples: [],
						sourceProjects: new Set(),
						confidence: 0,
					});
				}

				const pattern = patternMap.get(key)!;
				pattern.count++;
				pattern.examples.push(transfer.content);
				pattern.sourceProjects.add(transfer.sourceProjectId);
				pattern.confidence = Math.max(pattern.confidence, transfer.confidence);
			}
		}

		// Convert to KnowledgePattern objects
		for (const [patternText, data] of patternMap) {
			if (data.count >= 2) {
				// Require at least 2 occurrences
				patterns.push({
					id: `pattern_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
					name: this.generatePatternName(patternText),
					description: this.generatePatternDescription(patternText),
					pattern: patternText,
					examples: data.examples.slice(0, 5), // Limit examples
					confidence: data.confidence,
					sourceProjects: Array.from(data.sourceProjects),
				});
			}
		}

		// Sort by confidence and count
		return patterns.sort((a, b) => {
			const scoreA = a.confidence * Math.log(a.sourceProjects.length + 1);
			const scoreB = b.confidence * Math.log(b.sourceProjects.length + 1);
			return scoreB - scoreA;
		});
	}

	/**
	 * Extract solutions from project knowledge and transfers
	 */
	private async extractSolutions(
		projects: ProjectKnowledge[],
		transfers: KnowledgeTransfer[]
	): Promise<KnowledgeSolution[]> {
		const solutions: KnowledgeSolution[] = [];
		const solutionMap = new Map<
			string,
			{
				count: number;
				sourceProjects: Set<string>;
				effectiveness: number;
				relatedPatterns: Set<string>;
			}
		>();

		// Analyze transfers for solutions
		for (const transfer of transfers) {
			if (
				transfer.knowledgeType === 'solution' &&
				transfer.confidence >= this.options.minConfidence
			) {
				const key = this.normalizeSolution(transfer.content);
				if (!solutionMap.has(key)) {
					solutionMap.set(key, {
						count: 0,
						sourceProjects: new Set(),
						effectiveness: 0,
						relatedPatterns: new Set(),
					});
				}

				const solution = solutionMap.get(key)!;
				solution.count++;
				solution.sourceProjects.add(transfer.sourceProjectId);
				solution.effectiveness = Math.max(solution.effectiveness, transfer.confidence);
			}
		}

		// Convert to KnowledgeSolution objects
		for (const [solutionText, data] of solutionMap) {
			if (data.count >= 1) {
				// Require at least 1 occurrence
				solutions.push({
					id: `solution_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
					problem: this.extractProblem(solutionText),
					solution: solutionText,
					context: this.extractContext(solutionText),
					effectiveness: data.effectiveness,
					sourceProjects: Array.from(data.sourceProjects),
					relatedPatterns: Array.from(data.relatedPatterns),
				});
			}
		}

		// Sort by effectiveness
		return solutions.sort((a, b) => b.effectiveness - a.effectiveness);
	}

	/**
	 * Generate guidelines from patterns and solutions
	 */
	private async generateGuidelines(
		patterns: KnowledgePattern[],
		solutions: KnowledgeSolution[],
		projects: ProjectKnowledge[]
	): Promise<KnowledgeGuideline[]> {
		const guidelines: KnowledgeGuideline[] = [];

		// Generate best practice guidelines from high-confidence patterns
		const highConfidencePatterns = patterns.filter(p => p.confidence >= 0.8);
		for (const pattern of highConfidencePatterns.slice(0, 5)) {
			guidelines.push({
				id: `guideline_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
				title: `Best Practice: ${pattern.name}`,
				content: `Follow this pattern: ${pattern.description}\n\nExamples:\n${pattern.examples.join('\n')}`,
				category: 'best_practice',
				priority: 'high',
				sourceProjects: pattern.sourceProjects,
			});
		}

		// Generate anti-pattern guidelines from low-confidence patterns
		const lowConfidencePatterns = patterns.filter(p => p.confidence < 0.5);
		for (const pattern of lowConfidencePatterns.slice(0, 3)) {
			guidelines.push({
				id: `guideline_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
				title: `Avoid: ${pattern.name}`,
				content: `This pattern has low confidence and should be avoided: ${pattern.description}`,
				category: 'anti_pattern',
				priority: 'medium',
				sourceProjects: pattern.sourceProjects,
			});
		}

		// Generate tips from effective solutions
		const effectiveSolutions = solutions.filter(s => s.effectiveness >= 0.8);
		for (const solution of effectiveSolutions.slice(0, 5)) {
			guidelines.push({
				id: `guideline_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
				title: `Tip: ${solution.problem}`,
				content: `Solution: ${solution.solution}\n\nContext: ${solution.context}`,
				category: 'tip',
				priority: 'medium',
				sourceProjects: solution.sourceProjects,
			});
		}

		return guidelines;
	}

	/**
	 * Create synthesized knowledge content
	 */
	private async createSynthesizedKnowledge(
		patterns: KnowledgePattern[],
		solutions: KnowledgeSolution[],
		guidelines: KnowledgeGuideline[],
		projects: ProjectKnowledge[]
	): Promise<string> {
		const sections = [];

		// Executive summary
		sections.push(`# Cross-Project Knowledge Synthesis\n`);
		sections.push(
			`Generated from ${projects.length} projects across ${new Set(projects.map(p => p.domain)).size} domains.\n`
		);

		// Patterns section
		if (patterns.length > 0) {
			sections.push(`## Identified Patterns (${patterns.length})\n`);
			for (const pattern of patterns.slice(0, 5)) {
				sections.push(`### ${pattern.name}`);
				sections.push(`${pattern.description}\n`);
				sections.push(`**Confidence:** ${(pattern.confidence * 100).toFixed(1)}%\n`);
				sections.push(`**Source Projects:** ${pattern.sourceProjects.length}\n`);
			}
		}

		// Solutions section
		if (solutions.length > 0) {
			sections.push(`## Effective Solutions (${solutions.length})\n`);
			for (const solution of solutions.slice(0, 5)) {
				sections.push(`### ${solution.problem}`);
				sections.push(`${solution.solution}\n`);
				sections.push(`**Effectiveness:** ${(solution.effectiveness * 100).toFixed(1)}%\n`);
			}
		}

		// Guidelines section
		if (guidelines.length > 0) {
			sections.push(`## Guidelines (${guidelines.length})\n`);
			for (const guideline of guidelines) {
				sections.push(`### ${guideline.title} [${guideline.category.toUpperCase()}]`);
				sections.push(`${guideline.content}\n`);
			}
		}

		return sections.join('\n');
	}

	/**
	 * Calculate overall confidence score
	 */
	private calculateConfidence(
		patterns: KnowledgePattern[],
		solutions: KnowledgeSolution[],
		projects: ProjectKnowledge[]
	): number {
		if (patterns.length === 0 && solutions.length === 0) {
			return 0;
		}

		const patternConfidence =
			patterns.length > 0
				? patterns.reduce((sum, p) => sum + p.confidence, 0) / patterns.length
				: 0;

		const solutionConfidence =
			solutions.length > 0
				? solutions.reduce((sum, s) => sum + s.effectiveness, 0) / solutions.length
				: 0;

		const diversityBonus = Math.min(projects.length / 10, 0.2); // Bonus for project diversity

		return Math.min((patternConfidence + solutionConfidence) / 2 + diversityBonus, 1.0);
	}

	/**
	 * Generate recommendations
	 */
	private generateRecommendations(
		patterns: KnowledgePattern[],
		solutions: KnowledgeSolution[],
		guidelines: KnowledgeGuideline[]
	): string[] {
		const recommendations: string[] = [];

		if (patterns.length > 0) {
			recommendations.push(
    `Consider implementing the ${patterns[0]?.name || 'unknown'} pattern across similar projects`
			);
		}

		if (solutions.length > 0) {
   recommendations.push(`Apply the solution for "${solutions[0]?.problem || 'unknown'}" to related projects`);
		}

		if (guidelines.length > 0) {
			const bestPractices = guidelines.filter(g => g.category === 'best_practice');
			if (bestPractices.length > 0) {
     recommendations.push(`Follow the best practice: ${bestPractices[0]?.title || 'unknown'}`);
			}
		}

		if (patterns.length < 3) {
			recommendations.push('Consider collecting more pattern data to improve synthesis quality');
		}

		return recommendations;
	}

	// Helper methods
	private normalizePattern(text: string): string {
		return text.toLowerCase().trim().replace(/\s+/g, ' ');
	}

	private normalizeSolution(text: string): string {
		return text.toLowerCase().trim().replace(/\s+/g, ' ');
	}

	private generatePatternName(text: string): string {
		const words = text.split(' ').slice(0, 3);
		return words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
	}

	private generatePatternDescription(text: string): string {
		return text.length > 100 ? text.substring(0, 100) + '...' : text;
	}

	private extractProblem(text: string): string {
		// Simple extraction - look for problem indicators
		const problemIndicators = ['problem', 'issue', 'challenge', 'error', 'bug'];
		const sentences = text.split(/[.!?]+/);
		const problemSentence = sentences.find(s =>
			problemIndicators.some(indicator => s.toLowerCase().includes(indicator))
		);
		return problemSentence || sentences[0] || text.substring(0, 50);
	}

	private extractContext(text: string): string {
		// Extract context from the text
		return text.length > 200 ? text.substring(0, 200) + '...' : text;
	}
}
