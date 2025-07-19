// Security utilities for API server

// Sensitive field patterns that should be redacted
const SENSITIVE_PATTERNS = [
	/api[_-]?key/i,
	/secret/i,
	/token/i,
	/password/i,
	/auth/i,
	/credential/i,
	/private[_-]?key/i,
];

// Environment variables that should be redacted
const SENSITIVE_ENV_VARS = [
	'OPENAI_API_KEY',
	'ANTHROPIC_API_KEY',
	'GEMINI_API_KEY',
	'OPENROUTER_API_KEY',
	'DATABASE_URL',
	'REDIS_URL',
	'QDRANT_API_KEY',
	'MILVUS_TOKEN',
];

/**
 * Redacts sensitive information from any object
 */
export function redactSensitiveData(obj: any): any {
	if (typeof obj !== 'object' || obj === null) {
		return obj;
	}

	if (Array.isArray(obj)) {
		return obj.map(item => redactSensitiveData(item));
	}

	const redacted: any = {};

	for (const [key, value] of Object.entries(obj)) {
		// Check if key matches sensitive patterns
		const isSensitive = SENSITIVE_PATTERNS.some(pattern => pattern.test(key));

		if (isSensitive && typeof value === 'string') {
			redacted[key] = maskValue(value);
		} else if (typeof value === 'object') {
			redacted[key] = redactSensitiveData(value);
		} else {
			redacted[key] = value;
		}
	}

	return redacted;
}

/**
 * Masks a string value, showing only first and last few characters
 */
function maskValue(value: string): string {
	if (!value || value.length <= 8) {
		return '***';
	}

	const start = value.slice(0, 4);
	const end = value.slice(-4);
	const middle = '*'.repeat(Math.max(4, value.length - 8));

	return `${start}${middle}${end}`;
}

/**
 * Redacts sensitive environment variables
 */
export function redactEnvironmentVars(
	env: Record<string, string | undefined>
): Record<string, string | undefined> {
	const redacted: Record<string, string | undefined> = {};

	for (const [key, value] of Object.entries(env)) {
		if (SENSITIVE_ENV_VARS.includes(key) && value) {
			redacted[key] = maskValue(value);
		} else {
			redacted[key] = value;
		}
	}

	return redacted;
}

/**
 * Sanitizes user input to prevent injection attacks
 */
export function sanitizeInput(input: string): string {
	if (typeof input !== 'string') {
		return input;
	}

	// Remove null bytes and control characters except newlines and tabs
	// eslint-disable-next-line no-control-regex
	return input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

/**
 * Validates that a string is a valid UUID
 */
export function isValidUUID(uuid: string): boolean {
	const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
	return uuidRegex.test(uuid);
}

/**
 * Validates session ID format (allows UUID or custom format)
 */
export function isValidSessionId(sessionId: string): boolean {
	// Allow UUID format or alphanumeric with hyphens/underscores (max 50 chars)
	return isValidUUID(sessionId) || /^[a-zA-Z0-9_-]{1,50}$/.test(sessionId);
}
