/**
 * Resolves a transport client ID to its associated project path.
 * Returns undefined for global-scope clients (services fall back to process.cwd()).
 */
export type ProjectPathResolver = (clientId: string) => string | undefined

/**
 * Broadcasts an event to the project-scoped room for a given project path.
 * Silently skips if the project is not registered or routing is unavailable.
 */
export type ProjectBroadcaster = <T = unknown>(projectPath: string, event: string, data: T) => void
