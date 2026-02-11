/**
 * Environment utilities for TUI
 *
 * Simple environment checks and constants that don't require server imports.
 */

/**
 * Check if the current environment is development.
 * Uses BRV_ENV which is set by bin/dev.js and bin/run.js.
 */
export const isDevelopment = (): boolean => process.env.BRV_ENV === 'development'

/**
 * Project-level ByteRover directory name.
 */
export const BRV_DIR = '.brv'
