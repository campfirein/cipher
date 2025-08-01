// Compression module exports
export * from './types.js';
export * from './factory.js';
export * from './utils.js';

// Strategy exports
export { MiddleRemovalStrategy } from './strategies/middle-removal.js';
export { OldestRemovalStrategy } from './strategies/oldest-removal.js';
export { HybridStrategy } from './strategies/hybrid.js';
