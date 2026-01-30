import type {IToolProvider} from '../../core/interfaces/i-tool-provider.js'

/**
 * Lazy getter for ToolProvider to avoid circular dependencies.
 * Used by batch tool to execute other tools at runtime.
 */
export type ToolProviderGetter = () => IToolProvider
