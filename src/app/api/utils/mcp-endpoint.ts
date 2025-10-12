/**
 * MCP Endpoint Utilities
 *
 * Helper functions for constructing MCP endpoint URLs with proper context path handling
 * when behind reverse proxies.
 */

import { Request } from 'express';

/**
 * Extract the context path from the request
 * Checks X-Forwarded-Prefix header and PROXY_CONTEXT_PATH environment variable
 */
export function getContextPath(req: Request): string {
	const forwardedPrefix = req.headers['x-forwarded-prefix'] as string;
	const envPrefix = process.env.PROXY_CONTEXT_PATH;
	return forwardedPrefix || envPrefix || '';
}

/**
 * Build a full URL from request headers and path
 * Useful for constructing SSE endpoint URLs
 */
export function buildFullUrl(req: Request, path: string): string {
	const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol;
	const host = (req.headers['x-forwarded-host'] as string) || req.get('host') || 'localhost';
	const contextPath = getContextPath(req);
	const fullPath = contextPath + path;

	return `${proto}://${host}${fullPath}`;
}

/**
 * Validate session ID format
 */
export function isValidSessionId(sessionId: string): boolean {
	// Session IDs should be alphanumeric with hyphens, between 8 and 128 characters
	return /^[a-zA-Z0-9-_]{8,128}$/.test(sessionId);
}

/**
 * Extract session ID from multiple sources (query, header, body)
 * Returns the first valid session ID found
 */
export function extractSessionId(req: Request): string | undefined {
	const sources = [
		req.query.sessionId as string,
		req.headers['x-session-id'] as string,
		req.body?.sessionId as string,
	];

	return sources.find(id => id && typeof id === 'string');
}
