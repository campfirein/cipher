/**
 * Time utility functions for formatting timestamps
 */

/**
 * Format a Date as local time HH:MM:SS
 *
 * @param date - The date to format
 * @returns Formatted time string (e.g., "14:30:45")
 */
export function formatTime(date: Date): string {
  const hours = date.getHours().toString().padStart(2, '0')
  const minutes = date.getMinutes().toString().padStart(2, '0')
  const seconds = date.getSeconds().toString().padStart(2, '0')
  return `${hours}:${minutes}:${seconds}`
}
