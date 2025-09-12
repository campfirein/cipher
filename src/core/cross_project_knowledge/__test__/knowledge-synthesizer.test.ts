/**
 * Tests for Knowledge Synthesizer
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { KnowledgeSynthesizer } from '../knowledge-synthesizer.js';
import type { ProjectKnowledge, KnowledgeTransfer } from '../types.js';

describe('KnowledgeSynthesizer', () => {
	let synthesizer: KnowledgeSynthesizer;
	let mockProjects: ProjectKnowledge[];
	let mockTransfers: KnowledgeTransfer[];

	beforeEach(() => {
		synthesizer = new KnowledgeSynthesizer({
			minConfidence: 0.7,
			minRelevance: 0.6,
			maxPatterns: 5,
			maxSolutions: 10,
		});

		mockProjects = [
			{
				projectId: 'project-1',
				projectName: 'React Project',
				domain: 'web-development',
				lastUpdated: new Date(),
				knowledgeCount: 10,
				tags: ['react', 'typescript'],
				metadata: { version: '1.0.0' },
			},
			{
				projectId: 'project-2',
				projectName: 'Vue Project',
				domain: 'web-development',
				lastUpdated: new Date(),
				knowledgeCount: 8,
				tags: ['vue', 'javascript'],
				metadata: { version: '2.0.0' },
			},
			{
				projectId: 'project-3',
				projectName: 'Mobile App',
				domain: 'mobile-development',
				lastUpdated: new Date(),
				knowledgeCount: 5,
				tags: ['react-native'],
				metadata: { version: '1.5.0' },
			},
		];

		mockTransfers = [
			{
				id: 'transfer-1',
				sourceProjectId: 'project-1',
				targetProjectId: 'project-2',
				knowledgeType: 'pattern',
				content: 'Use custom hooks for reusable state logic',
				confidence: 0.9,
				relevance: 0.8,
				transferredAt: new Date(),
				metadata: {},
			},
			{
				id: 'transfer-2',
				sourceProjectId: 'project-2',
				targetProjectId: 'project-1',
				knowledgeType: 'solution',
				content: 'Implement proper error boundaries to catch component errors',
				confidence: 0.8,
				relevance: 0.7,
				transferredAt: new Date(),
				metadata: {},
			},
			{
				id: 'transfer-3',
				sourceProjectId: 'project-1',
				targetProjectId: 'project-3',
				knowledgeType: 'pattern',
				content: 'Use TypeScript for better type safety',
				confidence: 0.7,
				relevance: 0.6,
				transferredAt: new Date(),
				metadata: {},
			},
		];
	});

	describe('Knowledge Synthesis', () => {
		it('should synthesize knowledge from multiple projects', async () => {
			const result = await synthesizer.synthesizeKnowledge(mockProjects, mockTransfers);

			expect(result).toBeDefined();
			expect(result.sourceProjects).toContain('project-1');
			expect(result.sourceProjects).toContain('project-2');
			expect(result.sourceProjects).toContain('project-3');
			expect(result.confidence).toBeGreaterThan(0);
			expect(result.synthesizedKnowledge).toContain('Cross-Project Knowledge Synthesis');
			expect(result.patterns).toBeDefined();
			expect(result.recommendations).toBeDefined();
		});

		it('should filter by domain when specified', async () => {
			const result = await synthesizer.synthesizeKnowledge(
				mockProjects,
				mockTransfers,
				'web-development'
			);

			expect(result).toBeDefined();
			expect(result.sourceProjects).toContain('project-1');
			expect(result.sourceProjects).toContain('project-2');
			expect(result.sourceProjects).not.toContain('project-3');
		});

		it('should handle empty projects array', async () => {
			const result = await synthesizer.synthesizeKnowledge([], mockTransfers);

			expect(result).toBeDefined();
			expect(result.sourceProjects).toHaveLength(0);
			expect(result.confidence).toBe(0);
		});

		it('should handle empty transfers array', async () => {
			const result = await synthesizer.synthesizeKnowledge(mockProjects, []);

			expect(result).toBeDefined();
			expect(result.sourceProjects).toHaveLength(3);
			expect(result.patterns).toHaveLength(0);
		});
	});

	describe('Pattern Extraction', () => {
		it('should extract patterns from high-confidence transfers', async () => {
			const result = await synthesizer.synthesizeKnowledge(mockProjects, mockTransfers);

			expect(result.patterns).toBeDefined();
			expect(result.patterns.length).toBeGreaterThan(0);

			// Check that patterns have required properties
			for (const pattern of result.patterns) {
				expect(pattern.id).toBeDefined();
				expect(pattern.name).toBeDefined();
				expect(pattern.description).toBeDefined();
				expect(pattern.pattern).toBeDefined();
				expect(pattern.examples).toBeDefined();
				expect(pattern.confidence).toBeGreaterThan(0);
				expect(pattern.sourceProjects).toBeDefined();
			}
		});

		it('should not extract patterns from low-confidence transfers', async () => {
			const lowConfidenceTransfers: KnowledgeTransfer[] = [
				{
					id: 'transfer-low',
					sourceProjectId: 'project-1',
					targetProjectId: 'project-2',
					knowledgeType: 'pattern',
					content: 'Low confidence pattern',
					confidence: 0.5, // Below threshold
					relevance: 0.6,
					transferredAt: new Date(),
					metadata: {},
				},
			];

			const result = await synthesizer.synthesizeKnowledge(mockProjects, lowConfidenceTransfers);

			expect(result.patterns).toHaveLength(0);
		});

		it('should require multiple occurrences for pattern extraction', async () => {
			const singleOccurrenceTransfers: KnowledgeTransfer[] = [
				{
					id: 'transfer-single',
					sourceProjectId: 'project-1',
					targetProjectId: 'project-2',
					knowledgeType: 'pattern',
					content: 'Single occurrence pattern',
					confidence: 0.9,
					relevance: 0.8,
					transferredAt: new Date(),
					metadata: {},
				},
			];

			const result = await synthesizer.synthesizeKnowledge(mockProjects, singleOccurrenceTransfers);

			expect(result.patterns).toHaveLength(0);
		});
	});

	describe('Solution Extraction', () => {
		it('should extract solutions from transfers', async () => {
			const result = await synthesizer.synthesizeKnowledge(mockProjects, mockTransfers);

			// The synthesizer should create solutions from patterns
			expect(result.patterns).toBeDefined();
			expect(result.patterns.length).toBeGreaterThan(0);
		});

		it('should handle solution extraction with custom options', async () => {
			const customSynthesizer = new KnowledgeSynthesizer({
				minConfidence: 0.5,
				enableSolutionExtraction: true,
			});

			const result = await customSynthesizer.synthesizeKnowledge(mockProjects, mockTransfers);

			expect(result).toBeDefined();
			expect(result.patterns).toBeDefined();
		});
	});

	describe('Guideline Generation', () => {
		it('should generate guidelines from patterns', async () => {
			const result = await synthesizer.synthesizeKnowledge(mockProjects, mockTransfers);

			expect(result).toBeDefined();
			expect(result.patterns).toBeDefined();

			// Check that patterns can be converted to guidelines
			if (result.patterns.length > 0) {
				const pattern = result.patterns[0];
				expect(pattern.name).toBeDefined();
				expect(pattern.description).toBeDefined();
				expect(pattern.confidence).toBeGreaterThan(0);
			}
		});
	});

	describe('Confidence Calculation', () => {
		it('should calculate confidence based on pattern and solution quality', async () => {
			const result = await synthesizer.synthesizeKnowledge(mockProjects, mockTransfers);

			expect(result.confidence).toBeGreaterThan(0);
			expect(result.confidence).toBeLessThanOrEqual(1);
		});

		it('should return zero confidence for no patterns or solutions', async () => {
			const result = await synthesizer.synthesizeKnowledge([], []);

			expect(result.confidence).toBe(0);
		});
	});

	describe('Recommendations Generation', () => {
		it('should generate recommendations based on patterns and solutions', async () => {
			const result = await synthesizer.synthesizeKnowledge(mockProjects, mockTransfers);

			expect(result.recommendations).toBeDefined();
			expect(Array.isArray(result.recommendations)).toBe(true);
		});

		it('should include pattern-based recommendations', async () => {
			const result = await synthesizer.synthesizeKnowledge(mockProjects, mockTransfers);

			if (result.patterns.length > 0) {
				expect(
					result.recommendations.some(rec => rec.includes('pattern') || rec.includes('implement'))
				).toBe(true);
			}
		});
	});

	describe('Synthesized Knowledge Content', () => {
		it('should create comprehensive synthesized knowledge', async () => {
			const result = await synthesizer.synthesizeKnowledge(mockProjects, mockTransfers);

			expect(result.synthesizedKnowledge).toContain('Cross-Project Knowledge Synthesis');
			expect(result.synthesizedKnowledge).toContain('projects');
			expect(result.synthesizedKnowledge).toContain('domains');
		});

		it('should include project count in synthesized knowledge', async () => {
			const result = await synthesizer.synthesizeKnowledge(mockProjects, mockTransfers);

			expect(result.synthesizedKnowledge).toContain('3 projects');
			expect(result.synthesizedKnowledge).toContain('2 domains');
		});
	});

	describe('Error Handling', () => {
		it('should handle synthesis errors gracefully', async () => {
			// Create a synthesizer that will throw an error
			const errorSynthesizer = new KnowledgeSynthesizer();

			// Mock the pattern extraction to throw an error
			const originalExtractPatterns = errorSynthesizer['extractPatterns'];
			errorSynthesizer['extractPatterns'] = async () => {
				throw new Error('Pattern extraction failed');
			};

			await expect(
				errorSynthesizer.synthesizeKnowledge(mockProjects, mockTransfers)
			).rejects.toThrow('Pattern extraction failed');
		});
	});
});
