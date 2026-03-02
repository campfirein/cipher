/**
 * TUI Hooks
 *
 * Barrel export for all hooks. Feature-specific hooks are re-exported
 * from their respective feature folders for convenience.
 */

// Feature: Activity
export {parseExecutionContent, useActivityLogs} from '../features/activity/hooks/use-activity-logs.js'
export type {UseActivityLogsReturn} from '../features/activity/hooks/use-activity-logs.js'
export {useFeedNavigation} from '../features/activity/hooks/use-feed-navigation.js'
// Feature: Commands
export {useCommands, useCommandsController} from '../features/commands/hooks/use-commands-controller.js'

export {useSlashCommandProcessor} from '../features/commands/hooks/use-slash-command-processor.js'
export {useSlashCompletion} from '../features/commands/hooks/use-slash-completion.js'
export {useCommandsStore} from '../features/commands/stores/commands-store.js'

// Stores
export {useMode, useModeStore} from '../stores/mode-store.js'
export type {Mode, Shortcut} from '../stores/mode-store.js'
export {useTheme, useThemeStore} from '../stores/theme-store.js'
export type {Theme, ThemeColors, ThemeName} from '../stores/theme-store.js'

// Generic UI utilities (kept in this folder)
export {useIsLatestVersion} from './use-is-latest-version.js'
export {useTerminalBreakpoint} from './use-terminal-breakpoint.js'
export type {TerminalBreakpoint, TerminalBreakpointReturn} from './use-terminal-breakpoint.js'
export {useUIHeights} from './use-ui-heights.js'
export type {MessageItemHeights, UIHeights} from './use-ui-heights.js'
export {useVisibleWindow} from './use-visible-window.js'
export type {UseVisibleWindowReturn} from './use-visible-window.js'
