/**
 * Tests for System Prompt Architecture Interfaces
 */

import { describe, it, expect } from 'vitest';
import { ProviderType } from '../interfaces.js';

describe('System Prompt Interfaces', () => {
	describe('ProviderType', () => {
		it('should have correct enum values', () => {
			expect(ProviderType.STATIC).toBe('static');
			expect(ProviderType.DYNAMIC).toBe('dynamic');
			expect(ProviderType.FILE_BASED).toBe('file-based');
		});

		it('should have all expected types', () => {
			const types = Object.values(ProviderType);
			expect(types).toHaveLength(3);
			expect(types).toContain('static');
			expect(types).toContain('dynamic');
			expect(types).toContain('file-based');
		});
	});
});
