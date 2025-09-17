/**
 * Knowledge Synthesizer - Core intelligence for cross-project knowledge analysis
 *
 * Analyzes knowledge transfers to identify patterns, solutions, and guidelines
 * that can be shared across projects. Uses frequency analysis and confidence
 * scoring to determine which knowledge is most valuable and reliable.
 *
 * Why this exists: Teams often solve similar problems independently. This class
 * identifies common solutions and patterns so knowledge can be shared effectively.
 */

import { logger } from '../index.js';
import { loadCrossProjectConfig } from './cross-project-config.js';
import type {
	ProjectKnowledge,
	KnowledgeTransfer,
	KnowledgeSynthesisResult,
	KnowledgePattern,
	KnowledgeSolution,
	KnowledgeGuideline,
} from './types.js';

/**
 * Configuration for knowledge synthesis algorithms
 *
 * Controls quality thresholds and feature enablement to balance
 * synthesis quality with performance and resource usage.
 */
export interface SynthesisOptions {
	/** Minimum confidence (0-1) - filters out low-quality knowledge */
	minConfidence: number;
	/** Minimum relevance (0-1) - ensures knowledge is applicable */
	minRelevance: number;
	/** Max patterns returned - prevents overwhelming output */
	maxPatterns: number;
	/** Max solutions returned - limits result set size */
	maxSolutions: number;
	/** Enable pattern detection - can be disabled for performance */
	enablePatternDetection: boolean;
	/** Enable solution extraction - can be disabled for performance */
	enableSolutionExtraction: boolean;
	/** Enable guideline generation - can be disabled for performance */
	enableGuidelineGeneration: boolean;
	/** If true, throw when no patterns and solutions are found */
	errorOnEmpty?: boolean;
}

/**
 * Main class for analyzing and synthesizing cross-project knowledge
 *
 * Processes knowledge transfers to find patterns and solutions that
 * can be shared across projects, reducing duplicate work and improving
 * team efficiency.
 */
export class KnowledgeSynthesizer {
	private options: SynthesisOptions;

	/**
	 * Creates synthesizer with configuration from environment variables
	 *
	 * @param options - Optional partial config to override environment settings
	 *
	 * Loads configuration from environment variables with sensible defaults.
	 * Can be overridden with partial config for testing or custom setups.
	 */
	constructor(options: Partial<SynthesisOptions> = {}) {
		// Load configuration from environment variables
		const envConfig = loadCrossProjectConfig();

		// Merge environment config with provided overrides
		this.options = {
			...envConfig.synthesisOptions,
			...options,
		};
	}

	/**
	 * Main synthesis method - analyzes projects to find shareable knowledge
	 *
	 * @param projects - Projects to analyze for knowledge patterns
	 * @param transfers - Knowledge transfers between projects
	 * @param domain - Optional filter to focus on specific domain
	 * @returns Complete synthesis with patterns, solutions, and confidence score
	 *
	 * Process: Filter by domain → Extract patterns → Extract solutions →
	 * Generate guidelines → Calculate confidence → Return results
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

			// Filter to domain-specific projects for focused analysis (case-insensitive)
			const relevantProjects = domain
				? projects.filter(p => p.domain?.toLowerCase() === domain.toLowerCase())
				: projects;

			// Include transfers both TO and FROM domain projects
			const relevantTransfers = domain
				? transfers.filter(t => {
						const sourceProject = projects.find(p => p.projectId === t.sourceProjectId);
						const targetProject = projects.find(p => p.projectId === t.targetProjectId);
						const dom = domain.toLowerCase();
						return (
							sourceProject?.domain?.toLowerCase() === dom ||
							targetProject?.domain?.toLowerCase() === dom
						);
					})
				: transfers;

		// Extract recurring patterns across projects
		let patterns: KnowledgePattern[] = [];
		if (this.options.enablePatternDetection) {
			patterns = await this.extractPatterns(relevantProjects, relevantTransfers);
		}

		// Fallback: if no patterns found but there are multiple high-confidence pattern transfers,
		// synthesize minimal patterns from those transfers to satisfy cross-project visibility
		if (patterns.length === 0) {
			const highPatternTransfers = relevantTransfers.filter(
				t => t.knowledgeType === 'pattern' && t.confidence >= this.options.minConfidence
			);
			if (highPatternTransfers.length >= 2) {
				patterns = highPatternTransfers.slice(0, this.options.maxPatterns).map(t => ({
					id: `pattern_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
					name: this.generatePatternName(this.normalizePattern(t.content)),
					description: this.generatePatternDescription(t.content),
					pattern: this.normalizePattern(t.content),
					examples: [t.content],
					confidence: t.confidence,
					sourceProjects: [t.sourceProjectId],
				}));
			}
		}

			// Find effective problem-solution pairs
			const solutions = this.options.enableSolutionExtraction
				? await this.extractSolutions(relevantProjects, relevantTransfers)
				: [];

			// Generate actionable guidelines from patterns/solutions
			const guidelines = this.options.enableGuidelineGeneration
				? await this.generateGuidelines(patterns, solutions, relevantProjects)
				: [];

			// Create comprehensive markdown report
			const synthesizedKnowledge = await this.createSynthesizedKnowledge(
				patterns,
				solutions,
				guidelines,
				relevantProjects
			);

			// Calculate reliability score based on source diversity
			const confidence = this.calculateConfidence(patterns, solutions, relevantProjects);

			// If configured, throw when no useful knowledge found
			if ((this.options.errorOnEmpty ?? false) && patterns.length === 0 && solutions.length === 0) {
				throw new Error('No patterns or solutions found for the given inputs');
			}

			// Generate specific recommendations for teams
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
	 * Finds recurring patterns across projects using frequency analysis
	 *
	 * @param projects - Projects to analyze
	 * @param transfers - Knowledge transfers to examine
	 * @returns Patterns sorted by quality (confidence + source diversity)
	 *
	 * Algorithm: Normalize text → Group similar patterns → Track frequency →
	 * Filter by minimum occurrence (2+ projects) → Sort by composite score
	 */
	private async extractPatterns(
		projects: ProjectKnowledge[],
		transfers: KnowledgeTransfer[]
	): Promise<KnowledgePattern[]> {
		const patterns: KnowledgePattern[] = [];

		// Track pattern aggregation by normalized text to handle wording variations
		const patternMap = new Map<
			string,
			{
				count: number;
				examples: string[];
				sourceProjects: Set<string>;
				confidence: number;
			}
		>();

		// Process pattern-type transfers that meet confidence threshold
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

		// Decide gating rule based on total high-confidence pattern transfers
		const totalHighConfidencePatternTransfers = Array.from(patternMap.values()).reduce(
			(acc, v) => acc + v.count,
			0
		);

		for (const [patternText, data] of patternMap) {
			const meetsOccurrenceRule =
				totalHighConfidencePatternTransfers >= 2 ? data.count >= 1 : data.count >= 2;
			if (meetsOccurrenceRule) {
				patterns.push({
					id: `pattern_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
					name: this.generatePatternName(patternText),
					description: this.generatePatternDescription(patternText),
					pattern: patternText,
					examples: data.examples.slice(0, 5),
					confidence: data.confidence,
					sourceProjects: Array.from(data.sourceProjects),
				});
			}
		}

		// Sort by composite score: confidence * log(source diversity)
		// This prioritizes patterns with both high confidence AND multiple sources
		return patterns.sort((a, b) => {
			const scoreA = a.confidence * Math.log(a.sourceProjects.length + 1);
			const scoreB = b.confidence * Math.log(b.sourceProjects.length + 1);
			return scoreB - scoreA;
		});
	}

	/**
	 * Finds effective solutions to common problems
	 *
	 * @param projects - Projects to analyze
	 * @param transfers - Knowledge transfers to examine
	 * @returns Solutions sorted by effectiveness score
	 *
	 * Algorithm: Normalize text → Group similar solutions → Track effectiveness →
	 * Extract problem statements → Sort by effectiveness
	 */
	private async extractSolutions(
		_projects: ProjectKnowledge[],
		transfers: KnowledgeTransfer[]
	): Promise<KnowledgeSolution[]> {
		const solutions: KnowledgeSolution[] = [];

		// Track solution aggregation by normalized text
		const solutionMap = new Map<
			string,
			{
				count: number;
				sourceProjects: Set<string>;
				effectiveness: number;
				relatedPatterns: Set<string>;
			}
		>();

		// Process solution-type transfers that meet confidence threshold
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

		// Convert to solution objects - include single occurrences as they may be valuable
		for (const [solutionText, data] of solutionMap) {
			if (data.count >= 1) {
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

		// Sort by effectiveness - higher is better
		return solutions.sort((a, b) => b.effectiveness - a.effectiveness);
	}

	/**
	 * Generate guidelines from patterns and solutions
	 */
	private async generateGuidelines(
		patterns: KnowledgePattern[],
		solutions: KnowledgeSolution[],
		_projects: ProjectKnowledge[]
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
		_projects: ProjectKnowledge[]
	): Promise<string> {
		const sections = [];

		// Executive summary
		sections.push(`# Cross-Project Knowledge Synthesis\n`);
		sections.push(
			`Generated from ${_projects.length} projects across ${new Set(_projects.map(p => p.domain)).size} domains.\n`
		);

		// Patterns section (always include header)
		sections.push(`## Identified Patterns (${patterns.length})\n`);
		for (const pattern of patterns.slice(0, 5)) {
			sections.push(`### ${pattern.name}`);
			sections.push(`${pattern.description}\n`);
			sections.push(`**Confidence:** ${(pattern.confidence * 100).toFixed(1)}%\n`);
			sections.push(`**Source Projects:** ${pattern.sourceProjects.length}\n`);
		}

		// Solutions section (always include header)
		sections.push(`## Effective Solutions (${solutions.length})\n`);
		for (const solution of solutions.slice(0, 5)) {
			sections.push(`### ${solution.problem}`);
			sections.push(`${solution.solution}\n`);
			sections.push(`**Effectiveness:** ${(solution.effectiveness * 100).toFixed(1)}%\n`);
		}

		// Guidelines section (always include header)
		sections.push(`## Guidelines (${guidelines.length})\n`);
		for (const guideline of guidelines) {
			sections.push(`### ${guideline.title} [${guideline.category.toUpperCase()}]`);
			sections.push(`${guideline.content}\n`);
		}

		return sections.join('\n');
	}

	/**
	 * Calculates overall confidence score for synthesis reliability
	 *
	 * @param patterns - Identified patterns
	 * @param solutions - Identified solutions
	 * @param projects - Source projects
	 * @returns Confidence score (0-1) based on quality and source diversity
	 *
	 * Formula: (avg_pattern_confidence + avg_solution_effectiveness) / 2 + diversity_bonus
	 * Diversity bonus rewards multi-project knowledge (max 0.2)
	 */
	private calculateConfidence(
		patterns: KnowledgePattern[],
		solutions: KnowledgeSolution[],
		projects: ProjectKnowledge[]
	): number {
		// If there are no relevant projects, confidence is 0
		if (projects.length === 0) {
			return 0;
		}

		// Average pattern confidence
		const patternConfidence =
			patterns.length > 0
				? patterns.reduce((sum, p) => sum + p.confidence, 0) / patterns.length
				: 0;

		// Average solution effectiveness
		const solutionConfidence =
			solutions.length > 0
				? solutions.reduce((sum, s) => sum + s.effectiveness, 0) / solutions.length
				: 0;

		// Diversity bonus for multi-project knowledge (max 20%)
		const diversityBonus = Math.min(projects.length / 10, 0.2);

		// Combine with equal weight, add diversity bonus (even if no patterns/solutions), cap at 1.0
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
			recommendations.push(
				`Apply the solution for "${solutions[0]?.problem || 'unknown'}" to related projects`
			);
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

	// Helper methods for text processing

	/**
	 * Normalizes text for consistent comparison
	 * @param text - Text to normalize
	 * @returns Lowercase, trimmed text with normalized spaces
	 */
	private normalizePattern(text: string): string {
		return text.toLowerCase().trim().replace(/\s+/g, ' ');
	}

	/**
	 * Normalizes solution text (same as pattern normalization)
	 * @param text - Text to normalize
	 * @returns Normalized text
	 */
	private normalizeSolution(text: string): string {
		return text.toLowerCase().trim().replace(/\s+/g, ' ');
	}

	/**
	 * Creates human-readable pattern name from text
	 * @param text - Pattern text
	 * @returns Title-case name from first 3 words
	 */
	private generatePatternName(text: string): string {
		const words = text.split(' ').slice(0, 3);
		return words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
	}

	/**
	 * Creates truncated description for display
	 * @param text - Pattern text
	 * @returns Description limited to 100 chars
	 */
	private generatePatternDescription(text: string): string {
		return text.length > 100 ? text.substring(0, 100) + '...' : text;
	}

	/**
	 * Extracts problem statement from solution text
	 * @param text - Solution text to analyze
	 * @returns Problem statement or fallback text
	 *
	 * Looks for problem indicators like "problem", "issue", "error"
	 */
	private extractProblem(text: string): string {
		const problemIndicators = ['problem', 'issue', 'challenge', 'error', 'bug'];
		const sentences = text.split(/[.!?]+/);
		const problemSentence = sentences.find(s =>
			problemIndicators.some(indicator => s.toLowerCase().includes(indicator))
		);
		return problemSentence || sentences[0] || text.substring(0, 50);
	}

	/**
	 * Extracts context information from solution text
	 * @param text - Solution text
	 * @returns Context limited to 200 chars for readability
	 */
	private extractContext(text: string): string {
		return text.length > 200 ? text.substring(0, 200) + '...' : text;
	}
}
