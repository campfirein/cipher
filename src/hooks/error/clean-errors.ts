import type {Hook} from '@oclif/core'

/**
 * Hook to handle errors and provide clean error messages
 * Hides stack traces for user-facing errors
 */
const hook: Hook<'error'> = async function (options): Promise<void> {
  const {error} = options

  // Type guard for Error objects
  if (!(error instanceof Error)) {
    return
  }

  // Suppress oclif's default error output (stack traces)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (error as any).oclif

  // Handle validation errors (missing args, invalid flags, etc.)
  if (error.message.includes('Missing') && error.message.includes('required arg')) {
    // Extract the clean error message without stack trace
    const lines = error.message.split('\n')
    const errorLine = lines[0]
    const argLine = lines[1]

    // Use process.stderr.write to avoid oclif formatting (no › prefix)
    process.stderr.write('\n')
    process.stderr.write(errorLine + '\n')
    if (argLine) {
      process.stderr.write(argLine + '\n')
    }

    process.stderr.write('\n')
    process.stderr.write('See more help with --help\n')
    process.stderr.write('\n')

    // Prevent default error handling
    this.exit(2)
  }

  // For user-facing errors (network, auth, etc.), show clean message only
  // Check if error is already formatted with emoji prefix (❌, ⚠️, etc.)
  const isUserFacingError =
    error.message.startsWith('❌') || error.message.startsWith('⚠️') || error.message.includes('Network error')

  if (isUserFacingError) {
    // Just show the clean error message, no "See more help"
    process.stderr.write('\n')
    process.stderr.write(error.message + '\n')
    process.stderr.write('\n')
    this.exit(1)
  }

  // For other errors (unknown errors), show message + help hint
  process.stderr.write('\n')
  process.stderr.write(error.message + '\n')
  process.stderr.write('\n')
  process.stderr.write('See more help with --help\n')
  process.stderr.write('\n')
  this.exit(1)
}

export default hook
