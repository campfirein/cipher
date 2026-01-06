/**
 * Text Cleaner Utilities
 *
 * Shared text processing functions for Claude Code hooks.
 * These utilities handle prompt cleaning, tag removal, and text truncation.
 */

import {METADATA_TAGS} from '../claude/constants.js'
import {MAX_PROMPT_LENGTH} from './constants.js'

/**
 * Remove XML-like tags from text.
 * - Metadata tags (IDE/system): Remove ENTIRE tag including content
 * - Other tags: Keep content, remove only the tags
 *
 * Processing order:
 * 1. Remove metadata tags entirely (tag + content)
 * 2. Remove generic opening/closing tags (keep content)
 * 3. Remove self-closing tags
 * 4. Trim leading/trailing whitespace
 *
 * Original newlines, tabs, and multiple spaces are preserved.
 *
 * @param text - Text to clean
 * @returns Text with XML tags removed
 *
 * @example
 * cleanXmlTags('<ide_opened_file>src/app.ts</ide_opened_file>Hello')
 * Returns: 'Hello'
 *
 * @example
 * cleanXmlTags('<div>Hello <b>world</b></div>')
 * Returns: 'Hello world'
 */
export const cleanXmlTags = (text: string): string => {
  let cleaned = text

  for (const tag of METADATA_TAGS) {
    const regex = new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi')
    cleaned = cleaned.replaceAll(regex, '')
  }

  cleaned = cleaned.replaceAll(/<[a-z][\w-]*(?:\s[^>]*)?>/gi, '')
  cleaned = cleaned.replaceAll(/<\/[a-z][\w-]*>/gi, '')
  cleaned = cleaned.replaceAll(/<[a-z][\w-]*(?:\s[^>]*)?\s*\/>/gi, '')
  cleaned = cleaned.trim()

  return cleaned
}

/**
 * Truncate text to max length, adding ellipsis if truncated.
 *
 * @param text - Text to truncate
 * @param maxLength - Maximum length (default: MAX_PROMPT_LENGTH)
 * @returns Truncated text with ellipsis if needed
 *
 * @example
 * truncatePrompt('Hello World', 8)
 * Returns: 'Hello...'
 */
export const truncatePrompt = (text: string, maxLength: number = MAX_PROMPT_LENGTH): string => {
  if (text.length <= maxLength) {
    return text
  }

  return text.slice(0, maxLength - 3) + '...'
}
