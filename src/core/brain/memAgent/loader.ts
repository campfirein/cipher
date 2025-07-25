import { logger } from '../../logger/index.js';
import { AgentConfig } from './config.js';
import { parse as parseYaml } from 'yaml';
import { promises as fs } from 'fs';
import { env } from '../../env.js';

function expandEnvVars(config: any): any {
	if (typeof config === 'string') {
		const expanded = config.replace(
			/\$([A-Z_][A-Z0-9_]*)|\${([A-Z_][A-Z0-9_]*)}/gi,
			(_, v1, v2) => {
				const key = v1 || v2;
				return (env as any)[key] || '';
			}
		);

		// Try to convert numeric strings to numbers
		if (expanded !== config && /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(expanded.trim())) {
			return Number(expanded); // handles int, float, sci-notation
		}

		return expanded;
	} else if (Array.isArray(config)) {
		return config.map(expandEnvVars);
	} else if (typeof config === 'object' && config !== null) {
		const result: any = {};
		for (const key in config) {
			result[key] = expandEnvVars(config[key]);
		}
		return result;
	}
	return config;
}

export async function loadAgentConfig(configPath: string): Promise<AgentConfig> {
	try {
		// Determine where to load from: absolute, default, or user-relative

		logger.debug(`Loading cipher config from: ${configPath}`);

		// Read and parse the config file
		const fileContent = await fs.readFile(configPath, 'utf-8');

		try {
			// Parse YAML content
			const config = parseYaml(fileContent);
			// Expand env vars everywhere
			const expandedConfig = expandEnvVars(config);
			return expandedConfig;
		} catch (parseError) {
			throw new Error(
				`Failed to parse YAML: ${parseError instanceof Error ? parseError.message : String(parseError)}`
			);
		}
	} catch (error: any) {
		// Include path & cause for better diagnostics
		throw new Error(`Failed to load config file at ${error.path || configPath}: ${error.message}`);
	}
}

