import { z } from 'zod';
import { logger } from '@core/index.js';

export function validateCliOptions(opts: any): void {
	// Remove debug logging for CLI validation to reduce noise
	const cliOptionShape = z.object({
		verbose: z.boolean().optional().default(true),
		mode: z
			.enum(['cli', 'mcp', 'api', 'ui'], {
				errorMap: () => ({ message: 'Mode must be either cli, mcp, api, or ui' }),
			})
			.optional()
			.default('cli'),
		strict: z.boolean().optional().default(false),
		newSession: z.union([z.boolean(), z.string()]).optional(),
		port: z.string().optional(),
		uiPort: z.string().optional(),
		host: z.string().optional(),
		mcpTransportType: z.string().optional(),
		mcpPort: z.string().optional(),
	});

	const cliOptionSchema = cliOptionShape;

	const result = cliOptionSchema.safeParse({
		verbose: opts.verbose,
		mode: opts.mode,
		strict: opts.strict,
		newSession: opts.newSession,
		port: opts.port,
		uiPort: opts.uiPort,
		host: opts.host,
		mcpTransportType: opts.mcpTransportType,
		mcpPort: opts.mcpPort,
	});

	if (!result.success) {
		throw result.error;
	}

	// CLI options validated - no logging to reduce noise
}

export function handleCliOptionsError(error: unknown): never {
	if (error instanceof z.ZodError) {
		logger.error('Invalid command-line options detected:');
		error.errors.forEach(err => {
			const fieldName = err.path.join('.') || 'Unknown Option';
			logger.error(`- Option '${fieldName}': ${err.message}`);
		});
		logger.error('Please check your command-line arguments or run with --help for usage details.');
	} else {
		logger.error(
			`Validation error: ${error instanceof Error ? error.message : JSON.stringify(error)}`
		);
	}
	process.exit(1);
}
