/**
 * Memory Box System
 *
 * Implements the "box" concept from A-MEM paper where related memories are grouped together
 * following the Zettelkasten-inspired method described in the research.
 */

import type { MemoryNote as IMemoryNote, MemoryRelationship } from './types.js';
import { MemoryNote } from './memory-note.js';
import { LOG_PREFIXES } from './constants.js';
import { createLogger } from '../logger/index.js';
import { env } from '../env.js';

/**
 * Represents a box of related memories following A-MEM methodology
 */
export interface MemoryBox {
	/** Unique identifier for the box */
	id: string;

	/** Central theme or topic of the box */
	theme: string;

	/** Memory IDs contained in this box */
	memoryIds: Set<string>;

	/** Keywords that define this box */
	keywords: string[];

	/** Tags that characterize this box */
	tags: string[];

	/** Context description for this box */
	context: string;

	/** When this box was created */
	createdAt: string;

	/** When this box was last updated */
	lastUpdated: string;

	/** Strength of relationships within this box (0-1) */
	coherenceScore: number;
}

/**
 * Manages memory boxes for the A-MEM system
 */
export class MemoryBoxManager {
	private readonly logger = createLogger({ level: env.CIPHER_LOG_LEVEL });
	private readonly boxes = new Map<string, MemoryBox>();
	private readonly memoryToBoxMap = new Map<string, string[]>(); // Memory can be in multiple boxes

	/**
	 * Add a memory to appropriate boxes or create new ones
	 */
	async organizeMemory(
		memory: MemoryNote,
		existingMemories: Map<string, MemoryNote>
	): Promise<{
		boxId: string;
		isNewBox: boolean;
		relatedBoxes: string[];
	}> {
		this.logger.debug(`${LOG_PREFIXES.MEMORY_SYSTEM} Organizing memory into boxes`, {
			memoryId: memory.id,
			context: memory.context,
			tags: memory.tags,
		});

		// Find potential boxes for this memory
		const compatibleBoxes = this.findCompatibleBoxes(memory);

		if (compatibleBoxes.length > 0) {
			// Add to most compatible existing box
			const bestBox = compatibleBoxes[0];
			if (!bestBox) {
				// Fallback to creating new box
				const newBox = this.createNewBox(memory);
				this.boxes.set(newBox.id, newBox);
				this.addMemoryToBox(memory.id, newBox.id);
				return {
					boxId: newBox.id,
					isNewBox: true,
					relatedBoxes: [],
				};
			}

			this.addMemoryToBox(memory.id, bestBox.id);
			this.updateBoxCoherence(bestBox.id, existingMemories);

			this.logger.debug(`${LOG_PREFIXES.MEMORY_SYSTEM} Added memory to existing box`, {
				memoryId: memory.id,
				boxId: bestBox.id,
				boxTheme: bestBox.theme,
			});

			return {
				boxId: bestBox.id,
				isNewBox: false,
				relatedBoxes: compatibleBoxes.slice(1).map(b => b.id),
			};
		} else {
			// Create new box for this memory
			const newBox = this.createNewBox(memory);
			this.boxes.set(newBox.id, newBox);
			this.addMemoryToBox(memory.id, newBox.id);

			this.logger.debug(`${LOG_PREFIXES.MEMORY_SYSTEM} Created new memory box`, {
				memoryId: memory.id,
				boxId: newBox.id,
				boxTheme: newBox.theme,
			});

			return {
				boxId: newBox.id,
				isNewBox: true,
				relatedBoxes: [],
			};
		}
	}

	/**
	 * Get memories from the same box as the given memory
	 */
	getBoxNeighbors(memoryId: string, excludeMemoryId?: string): string[] {
		const boxIds = this.memoryToBoxMap.get(memoryId) || [];
		const neighbors = new Set<string>();

		for (const boxId of boxIds) {
			const box = this.boxes.get(boxId);
			if (box) {
				for (const memberId of box.memoryIds) {
					if (memberId !== memoryId && memberId !== excludeMemoryId) {
						neighbors.add(memberId);
					}
				}
			}
		}

		return Array.from(neighbors);
	}

	/**
	 * Get all boxes that contain related memories to the given memory
	 */
	getRelatedBoxes(memory: MemoryNote): MemoryBox[] {
		return this.findCompatibleBoxes(memory);
	}

	/**
	 * Remove memory from all boxes
	 */
	removeMemoryFromBoxes(memoryId: string): void {
		const boxIds = this.memoryToBoxMap.get(memoryId) || [];

		for (const boxId of boxIds) {
			const box = this.boxes.get(boxId);
			if (box) {
				box.memoryIds.delete(memoryId);
				box.lastUpdated = new Date().toISOString();

				// Remove empty boxes
				if (box.memoryIds.size === 0) {
					this.boxes.delete(boxId);
				}
			}
		}

		this.memoryToBoxMap.delete(memoryId);
	}

	/**
	 * Get box information for a memory
	 */
	getMemoryBoxInfo(memoryId: string): MemoryBox[] {
		const boxIds = this.memoryToBoxMap.get(memoryId) || [];
		return boxIds.map(boxId => this.boxes.get(boxId)).filter(Boolean) as MemoryBox[];
	}

	/**
	 * Get all boxes
	 */
	getAllBoxes(): MemoryBox[] {
		return Array.from(this.boxes.values());
	}

	/**
	 * Consolidate boxes by merging similar ones
	 */
	async consolidateBoxes(existingMemories: Map<string, MemoryNote>): Promise<{
		mergedBoxes: number;
		totalBoxes: number;
	}> {
		const boxList = Array.from(this.boxes.values());
		let mergedCount = 0;

		// Find boxes that should be merged based on similarity
		for (let i = 0; i < boxList.length; i++) {
			for (let j = i + 1; j < boxList.length; j++) {
				const box1 = boxList[i];
				const box2 = boxList[j];

				if (!box1 || !box2 || !this.boxes.has(box1.id) || !this.boxes.has(box2.id)) {
					continue; // Already merged or invalid
				}

				const similarity = this.calculateBoxSimilarity(box1, box2);
				if (similarity > 0.8) {
					// High similarity threshold
					this.mergeBoxes(box1.id, box2.id, existingMemories);
					mergedCount++;
				}
			}
		}

		return {
			mergedBoxes: mergedCount,
			totalBoxes: this.boxes.size,
		};
	}

	/**
	 * Find boxes compatible with the given memory
	 */
	private findCompatibleBoxes(memory: MemoryNote): MemoryBox[] {
		const compatibleBoxes: { box: MemoryBox; score: number }[] = [];

		for (const box of this.boxes.values()) {
			const score = this.calculateMemoryBoxCompatibility(memory, box);
			if (score > 0.6) {
				// Compatibility threshold
				compatibleBoxes.push({ box, score });
			}
		}

		// Sort by compatibility score (highest first)
		compatibleBoxes.sort((a, b) => b.score - a.score);

		return compatibleBoxes.map(item => item.box);
	}

	/**
	 * Calculate compatibility between memory and box
	 */
	private calculateMemoryBoxCompatibility(memory: MemoryNote, box: MemoryBox): number {
		let score = 0;
		let factors = 0;

		// Context similarity
		if (memory.context === box.context) {
			score += 0.4;
		}
		factors++;

		// Tag overlap
		const tagOverlap = memory.tags.filter(tag => box.tags.includes(tag)).length;
		const tagScore = tagOverlap / Math.max(memory.tags.length, box.tags.length, 1);
		score += tagScore * 0.3;
		factors++;

		// Keyword overlap
		const keywordOverlap = memory.keywords.filter(keyword =>
			box.keywords.some(
				boxKeyword =>
					keyword.toLowerCase().includes(boxKeyword.toLowerCase()) ||
					boxKeyword.toLowerCase().includes(keyword.toLowerCase())
			)
		).length;
		const keywordScore = keywordOverlap / Math.max(memory.keywords.length, box.keywords.length, 1);
		score += keywordScore * 0.3;
		factors++;

		return score / factors;
	}

	/**
	 * Create a new box for the given memory
	 */
	private createNewBox(memory: MemoryNote): MemoryBox {
		const boxId = `box_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
		const now = new Date().toISOString();

		return {
			id: boxId,
			theme: memory.context || 'General',
			memoryIds: new Set(),
			keywords: [...memory.keywords],
			tags: [...memory.tags],
			context: memory.context,
			createdAt: now,
			lastUpdated: now,
			coherenceScore: 1.0, // Perfect coherence for single memory
		};
	}

	/**
	 * Add memory to a box
	 */
	private addMemoryToBox(memoryId: string, boxId: string): void {
		const box = this.boxes.get(boxId);
		if (box) {
			box.memoryIds.add(memoryId);
			box.lastUpdated = new Date().toISOString();

			// Update memory to box mapping
			const existingBoxes = this.memoryToBoxMap.get(memoryId) || [];
			if (!existingBoxes.includes(boxId)) {
				existingBoxes.push(boxId);
				this.memoryToBoxMap.set(memoryId, existingBoxes);
			}
		}
	}

	/**
	 * Update box coherence score based on memory relationships
	 */
	private updateBoxCoherence(boxId: string, existingMemories: Map<string, MemoryNote>): void {
		const box = this.boxes.get(boxId);
		if (!box || box.memoryIds.size < 2) return;

		const memories = Array.from(box.memoryIds)
			.map(id => existingMemories.get(id))
			.filter((memory): memory is MemoryNote => memory !== undefined);

		if (memories.length < 2) return;

		// Calculate average similarity between all pairs in the box
		let totalSimilarity = 0;
		let pairCount = 0;

		for (let i = 0; i < memories.length; i++) {
			for (let j = i + 1; j < memories.length; j++) {
				const memory1 = memories[i];
				const memory2 = memories[j];
				if (memory1 && memory2) {
					const similarity = this.calculateMemorySimilarity(memory1, memory2);
					totalSimilarity += similarity;
					pairCount++;
				}
			}
		}

		box.coherenceScore = pairCount > 0 ? totalSimilarity / pairCount : 0;
	}

	/**
	 * Calculate similarity between two memories
	 */
	private calculateMemorySimilarity(memory1: MemoryNote, memory2: MemoryNote): number {
		let score = 0;

		// Context match
		if (memory1.context === memory2.context) score += 0.3;

		// Tag overlap
		const tagOverlap = memory1.tags.filter(tag => memory2.tags.includes(tag)).length;
		const tagScore = tagOverlap / Math.max(memory1.tags.length, memory2.tags.length, 1);
		score += tagScore * 0.4;

		// Keyword overlap
		const keywordOverlap = memory1.keywords.filter(keyword =>
			memory2.keywords.some(
				k2 =>
					keyword.toLowerCase().includes(k2.toLowerCase()) ||
					k2.toLowerCase().includes(keyword.toLowerCase())
			)
		).length;
		const keywordScore =
			keywordOverlap / Math.max(memory1.keywords.length, memory2.keywords.length, 1);
		score += keywordScore * 0.3;

		return score;
	}

	/**
	 * Calculate similarity between two boxes
	 */
	private calculateBoxSimilarity(box1: MemoryBox, box2: MemoryBox): number {
		let score = 0;

		// Context match
		if (box1.context === box2.context) score += 0.4;

		// Tag overlap
		const tagOverlap = box1.tags.filter(tag => box2.tags.includes(tag)).length;
		const tagScore = tagOverlap / Math.max(box1.tags.length, box2.tags.length, 1);
		score += tagScore * 0.3;

		// Keyword overlap
		const keywordOverlap = box1.keywords.filter(keyword =>
			box2.keywords.some(
				k2 =>
					keyword.toLowerCase().includes(k2.toLowerCase()) ||
					k2.toLowerCase().includes(keyword.toLowerCase())
			)
		).length;
		const keywordScore = keywordOverlap / Math.max(box1.keywords.length, box2.keywords.length, 1);
		score += keywordScore * 0.3;

		return score;
	}

	/**
	 * Merge two boxes together
	 */
	private mergeBoxes(
		sourceBoxId: string,
		targetBoxId: string,
		existingMemories: Map<string, MemoryNote>
	): void {
		const sourceBox = this.boxes.get(sourceBoxId);
		const targetBox = this.boxes.get(targetBoxId);

		if (!sourceBox || !targetBox) return;

		// Merge memory IDs
		for (const memoryId of sourceBox.memoryIds) {
			targetBox.memoryIds.add(memoryId);

			// Update memory to box mapping
			const boxIds = this.memoryToBoxMap.get(memoryId) || [];
			const sourceIndex = boxIds.indexOf(sourceBoxId);
			if (sourceIndex >= 0) {
				boxIds.splice(sourceIndex, 1);
			}
			if (!boxIds.includes(targetBoxId)) {
				boxIds.push(targetBoxId);
			}
			this.memoryToBoxMap.set(memoryId, boxIds);
		}

		// Merge metadata
		targetBox.keywords = [...new Set([...targetBox.keywords, ...sourceBox.keywords])];
		targetBox.tags = [...new Set([...targetBox.tags, ...sourceBox.tags])];
		targetBox.lastUpdated = new Date().toISOString();

		// Update coherence
		this.updateBoxCoherence(targetBoxId, existingMemories);

		// Remove source box
		this.boxes.delete(sourceBoxId);

		this.logger.debug(`${LOG_PREFIXES.MEMORY_SYSTEM} Merged memory boxes`, {
			sourceBoxId,
			targetBoxId,
			memoryCount: targetBox.memoryIds.size,
		});
	}
}
