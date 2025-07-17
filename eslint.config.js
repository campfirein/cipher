import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';

export default [
	// Base config for all files
	js.configs.recommended,
	{
		linterOptions: {
			reportUnusedDisableDirectives: 'warn',
		},
	},

	// TypeScript specific config
	{
		files: ['**/*.ts'],
		languageOptions: {
			parser: tsParser,
			ecmaVersion: 2022,
			sourceType: 'module',
			globals: {
				console: 'readonly',
				process: 'readonly',
				setTimeout: 'readonly',
				clearTimeout: 'readonly',
				global: 'readonly',
				require: 'readonly',
				__dirname: 'readonly',
				module: 'readonly',
				document: 'readonly',
				window: 'readonly',
				HTMLElement: 'readonly',
				HTMLAnchorElement: 'readonly',
				HTMLImageElement: 'readonly',
				Element: 'readonly',
				Node: 'readonly',
				clearInterval: 'readonly',
				setInterval: 'readonly',
				Buffer: 'readonly',
				URL: 'readonly',
				AbortController: 'readonly',
				AbortSignal: 'readonly',
				structuredClone: 'readonly',
				NodeJS: 'readonly',
				CustomEvent: 'readonly',
				localStorage: 'readonly',
				FileReader: 'readonly',
				WebSocket: 'readonly',
			},
		},
		plugins: {
			'@typescript-eslint': tseslint,
		},
		rules: {
			'no-console': 'off',
			'no-unused-vars': 'off',
			'@typescript-eslint/explicit-module-boundary-types': 'off',
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
			'no-dupe-class-members': 'off', // Allow TypeScript method overloading
		},
	},

	// JavaScript Client-side specific config
	{
		files: ['app/web/client/script.js'], // Make the path specific
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: 'module',
			globals: {
				// Define Browser globals
				window: 'readonly',
				document: 'readonly',
				console: 'readonly',
				setTimeout: 'readonly',
				clearTimeout: 'readonly', // Added clearTimeout
				WebSocket: 'readonly',
				// Add other browser APIs you use e.g.:
				// fetch: 'readonly',
				// localStorage: 'readonly',
				// navigator: 'readonly',
			},
		},
		rules: {
			// Add any JS specific rules if needed, otherwise inherit from recommended
			'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }], // Example JS rule
			// Disable no-undef specifically for this block if necessary,
			// but defining globals is preferred.
			// 'no-undef': 'off'
		},
	},

	// Add this override for test files using flat config globals
	{
		files: ["**/__test__/**/*.ts", "**/*.test.ts"],
		languageOptions: {
			globals: {
				describe: true,
				it: true,
				beforeEach: true,
				afterEach: true,
				expect: true,
				vi: true,
				test: true,
			},
		},
	},

	// Ignore patterns (keep existing ignores)
	{
		ignores: [
			'node_modules/**',
			'dist/**',
			'.cursor/**',
			'public/**',
			'src/app/webui/.next/**',
			'src/app/webui/out/**',
			'**/build/**',
			'**/coverage/**',
			'test-temp/**',
			'**/*.min.js',
			'**/generated/**',
			'docs/.docusaurus/**',
			'scripts/dev.js',
			'scripts/dev-status.js',
			'src/app/web/client/script.js',
			'src/app/webui/tailwind.config.js',
		],
	},
	prettier,
];
