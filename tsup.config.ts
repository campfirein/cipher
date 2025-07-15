import { defineConfig } from 'tsup';
export default defineConfig([
	{
		entry: ['src/core/index.ts'],
		format: ['cjs','esm'],
		outDir: 'dist/src/core',
		dts: true,
		shims: true,
		bundle: true,
		noExternal: ['chalk', 'boxen'],
		external: ['better-sqlite3', 'pg', 'redis'],
	},
	{
		entry: ['src/app/index.ts'],
		format: ['cjs'],  // Use only CommonJS for app to avoid dynamic require issues
		outDir: 'dist/src/app',
		shims: true,
		bundle: true,
		platform: 'node',
		target: 'node18',  // Specify Node.js target version
		external: [
			// Database drivers
			'better-sqlite3', 
			'pg', 
			'neo4j-driver', 
			'ioredis', 
			// CLI dependencies
			'commander',
			// Node.js built-in modules to prevent bundling issues
			'fs',
			'path',
			'os',
			'crypto',
			'stream',
			'util',
			'events',
			'child_process'
		],
		noExternal: ['chalk', 'boxen'],
	},
]);
