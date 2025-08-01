import { ZodError } from 'zod';
import { McpServerConfigSchema } from './config.js';
import { McpServerConfig } from './types.js';

export type ValidationErrorType =
	| 'missing_api_key'
	| 'invalid_model'
	| 'invalid_provider'
	| 'incompatible_model_provider'
	| 'unsupported_router'
	| 'invalid_base_url'
	| 'invalid_max_tokens'
	| 'schema_validation'
	| 'general';

export interface ValidationError {
	type: ValidationErrorType;
	message: string;
	field?: string;
	provider?: string;
	model?: string;
	router?: string;
	suggestedAction?: string;
}
export interface McpServerValidationResult {
	isValid: boolean;
	errors: ValidationError[];
	warnings: string[];
	config: McpServerConfig | undefined;
}

export function validateMcpServerConfig(
	serverName: string,
	serverConfig: McpServerConfig,
	existingServerNames: string[] = []
): McpServerValidationResult {
	const errors: ValidationError[] = [];
	const warnings: string[] = [];

	// Validate server name
	if (!serverName || typeof serverName !== 'string' || serverName.trim() === '') {
		errors.push({
			type: 'schema_validation',
			message: 'Server name must be a non-empty string',
			field: 'serverName',
			suggestedAction: 'Provide a valid server name',
		});
	}

	// Validate server config using Zod schema
	try {
		McpServerConfigSchema.parse(serverConfig);
	} catch (error) {
		if (error instanceof ZodError) {
			for (const issue of error.errors) {
				errors.push({
					type: 'schema_validation',
					message: `Invalid server configuration: ${issue.message}`,
					field: issue.path.join('.'),
					suggestedAction: 'Check the server configuration format and required fields',
				});
			}
		} else {
			errors.push({
				type: 'schema_validation',
				message: `Invalid server configuration: ${error instanceof Error ? error.message : 'Unknown validation error'}`,
				suggestedAction: 'Check the server configuration format and required fields',
			});
		}
	}

	// Additional business logic validation
	if (errors.length === 0) {
		// Check for duplicate server names (case-insensitive)
		const duplicateName = existingServerNames.find(
			name => name.toLowerCase() === serverName.toLowerCase() && name !== serverName
		);
		if (duplicateName) {
			warnings.push(
				`Server name '${serverName}' is similar to existing server '${duplicateName}' (case difference only)`
			);
		}

		// Type-specific validation - we know it's valid McpServerConfig at this point
		if (serverConfig.type === 'stdio') {
			if (!serverConfig.command || serverConfig.command.trim() === '') {
				errors.push({
					type: 'schema_validation',
					message: 'Stdio server requires a non-empty command',
					field: 'command',
					suggestedAction: 'Provide a valid command to execute',
				});
			}
		} else if (serverConfig.type === 'sse' || serverConfig.type === 'streamable-http') {
			const url = serverConfig.url;
			if (!url) {
				errors.push({
					type: 'schema_validation',
					message: 'URL is required for streamable-http/sse server types',
					field: 'url',
					suggestedAction: 'Provide a non-empty url string',
				});
			} else {
				try {
					new URL(url);
				} catch {
					errors.push({
						type: 'schema_validation',
						message: `Invalid URL format: ${url}`,
						field: 'url',
						suggestedAction: 'Provide a valid URL with protocol (http:// or https://)',
					});
				}
			}
		}
	}

	// If validation passed, parse through schema to apply defaults
	let validatedConfig: McpServerConfig | undefined;
	if (errors.length === 0) {
		try {
			validatedConfig = McpServerConfigSchema.parse(serverConfig) as McpServerConfig;
		} catch (schemaError) {
			if (schemaError instanceof ZodError) {
				for (const issue of schemaError.errors) {
					errors.push({
						type: 'schema_validation',
						message: `Schema parsing failed: ${issue.message}`,
						field: issue.path.join('.'),
					});
				}
			}
		}
	}

	return {
		isValid: errors.length === 0,
		errors,
		warnings,
		config: validatedConfig,
	};
}
