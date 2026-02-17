/**
 * Writes a JSON final response to stdout.
 * Used by oclif commands for --format json output.
 */
export function writeJsonResponse(options: {command: string; data: unknown; success: boolean}): void {
  process.stdout.write(
    JSON.stringify({
      ...options,
      timestamp: new Date().toISOString(),
    }) + '\n',
  )
}
