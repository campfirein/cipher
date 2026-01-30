/**
 * Emoji and message formatting helpers
 *
 * Provides utilities for checking and handling emoji prefixes in error messages
 * to prevent duplicate prefixes like "❌ Error: ❌ Billing error: ..."
 */

/**
 * Check if a message already has an emoji prefix
 *
 * Detects common emoji prefixes used in CLI output:
 * - ❌ (error)
 * - ✓ (success)
 * - ⚠️ (warning)
 * - Any Unicode emoji in ranges U+1F300–U+1F9FF
 *
 * @param message - Message to check
 * @returns true if message starts with emoji, false otherwise
 *
 * @example
 * hasEmojiPrefix("❌ Error message") // true
 * hasEmojiPrefix("✓ Success") // true
 * hasEmojiPrefix("Normal message") // false
 */
export function hasEmojiPrefix(message: string): boolean {
  return /^[\u{1F300}-\u{1F9FF}]|^❌|^✓|^⚠️/u.test(message)
}

/**
 * Add error prefix to message if it doesn't already have emoji prefix
 *
 * Prevents duplicate prefixes by checking if message already starts with emoji.
 * If message has emoji prefix, returns as-is. Otherwise, adds "❌ Error: " prefix.
 *
 * @param message - Error message to format
 * @returns Formatted error message with prefix
 *
 * @example
 * addErrorPrefix("❌ Billing error") // "❌ Billing error" (no duplicate)
 * addErrorPrefix("Something went wrong") // "❌ Error: Something went wrong"
 */
export function addErrorPrefix(message: string): string {
  return hasEmojiPrefix(message) ? message : `❌ Error: ${message}`
}
