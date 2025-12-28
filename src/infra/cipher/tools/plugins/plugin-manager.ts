import type { ToolExecutionResult } from '../../../../core/domain/cipher/tools/tool-error.js'
import type { IToolPlugin, ToolHookContext } from '../../../../core/interfaces/cipher/i-tool-plugin.js'

/**
 * Result from triggering before hooks.
 */
export interface BeforeTriggerResult {
  /** Modified arguments (may differ from original if plugins transformed them) */
  args: Record<string, unknown>

  /** Whether to proceed with execution */
  proceed: boolean

  /** Reason for blocking (if proceed is false) */
  reason?: string
}

/**
 * Manages tool execution plugins.
 *
 * Provides a plugin system for extending tool behavior with before/after hooks.
 * Plugins are executed in priority order (lower priority = earlier execution).
 *
 * @example
 * ```typescript
 * const manager = new ToolPluginManager()
 * manager.register(loggingPlugin)
 * manager.register(validationPlugin)
 *
 * // Before execution
 * const { proceed, args } = await manager.triggerBefore(ctx, originalArgs)
 * if (!proceed) return error
 *
 * // Execute tool...
 *
 * // After execution
 * await manager.triggerAfter(ctx, args, result)
 * ```
 */
export class ToolPluginManager {
  private static readonly DEFAULT_PRIORITY = 100
  private plugins: IToolPlugin[] = []

  /**
   * Get all registered plugins.
   * @returns Array of registered plugins in priority order
   */
  public getPlugins(): readonly IToolPlugin[] {
    return this.plugins
  }

  /**
   * Register a plugin.
   * Plugins are automatically sorted by priority after registration.
   *
   * @param plugin - Plugin to register
   */
  public register(plugin: IToolPlugin): void {
    this.plugins.push(plugin)
    this.sortByPriority()
  }

  /**
   * Trigger all afterExecute hooks.
   * Errors in individual plugins are caught and logged but don't propagate.
   *
   * @param ctx - Hook context
   * @param args - Arguments that were passed to the tool
   * @param result - Tool execution result
   */
  public async triggerAfter(
    ctx: ToolHookContext,
    args: Record<string, unknown>,
    result: ToolExecutionResult
  ): Promise<void> {
    const promises = this.plugins
      .filter((plugin) => plugin.afterExecute)
      .map(async (plugin) => {
        try {
          await plugin.afterExecute!(ctx, args, result)
        } catch (error) {
          console.warn(`Plugin ${plugin.name} afterExecute failed:`, error)
        }
      })

    await Promise.all(promises)
  }

  /**
   * Trigger all beforeExecute hooks in priority order.
   * If any plugin returns proceed: false, execution stops and returns that result.
   * Arguments can be transformed by plugins (each receives the previous plugin's output).
   *
   * @param ctx - Hook context
   * @param args - Original arguments
   * @returns Result indicating whether to proceed and final arguments
   */
  public async triggerBefore(
    ctx: ToolHookContext,
    args: Record<string, unknown>
  ): Promise<BeforeTriggerResult> {
    const pluginsWithBefore = this.plugins.filter((plugin) => plugin.beforeExecute)

    // Sequential execution required: each plugin may modify args for the next
    const processPlugin = async (
      index: number,
      currentArgs: Record<string, unknown>
    ): Promise<BeforeTriggerResult> => {
      if (index >= pluginsWithBefore.length) {
        return {
          args: currentArgs,
          proceed: true,
        }
      }

      const plugin = pluginsWithBefore[index]!

      try {
        const result = await plugin.beforeExecute!(ctx, currentArgs)

        if (!result.proceed) {
          return {
            args: currentArgs,
            proceed: false,
            reason: result.reason,
          }
        }

        const nextArgs = result.args ?? currentArgs
        return processPlugin(index + 1, nextArgs)
      } catch (error) {
        console.warn(`Plugin ${plugin.name} beforeExecute failed:`, error)
        // Continue with next plugin on error
        return processPlugin(index + 1, currentArgs)
      }
    }

    return processPlugin(0, { ...args })
  }

  /**
   * Unregister a plugin by name.
   *
   * @param name - Name of the plugin to unregister
   * @returns True if a plugin was removed
   */
  public unregister(name: string): boolean {
    const initialLength = this.plugins.length
    this.plugins = this.plugins.filter((p) => p.name !== name)

    return this.plugins.length < initialLength
  }

  /**
   * Sort plugins by priority (ascending).
   */
  private sortByPriority(): void {
    this.plugins.sort(
      (a, b) =>
        (a.priority ?? ToolPluginManager.DEFAULT_PRIORITY) -
        (b.priority ?? ToolPluginManager.DEFAULT_PRIORITY)
    )
  }
}
