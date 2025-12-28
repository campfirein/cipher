/**
 * Line utility functions for calculating visual line counts
 */

/**
 * Calculate visual line count for a single line, accounting for wrapping
 *
 * @param line - The text line to measure
 * @param maxCharsPerLine - Maximum characters per line (terminal width)
 * @returns Number of visual lines this text will occupy
 */
export function getVisualLineCount(line: string, maxCharsPerLine: number): number {
  if (maxCharsPerLine <= 0 || line.length === 0) {
    return 1
  }

  return Math.ceil(line.length / maxCharsPerLine) || 1
}
