import type {Hook} from '@oclif/core'

/**
 * Hook to handle command not found errors
 * Provides helpful error messages when users type invalid commands or subcommands
 */
const hook: Hook<'command_not_found'> = async function (options): Promise<void> {
  const {id} = options

  // Check if it's a cipher-agent subcommand typo
  if (id?.startsWith('cipher-agent:')) {
    const invalidSubcommand = id.replace('cipher-agent:', '')

    this.log()
    this.log(`Unknown cipher-agent command: "${invalidSubcommand}"`)
    this.log()
    this.log('USAGE')
    this.log('  $ brv cipher-agent COMMAND')
    this.log()
    this.log('COMMANDS')
    this.log('  cipher-agent run          Run CipherAgent in interactive or single-execution mode')
    this.log('  cipher-agent set-prompt   Set custom system prompt for CipherAgent')
    this.log('  cipher-agent show-prompt  Show the current CipherAgent system prompt')
    this.log()

    // Exit with error code
    this.exit(1)
  }

  // Default error message for other commands
  this.log()
  this.log(`Command "${id}" not found`)
  this.log()
  this.log('Run "brv --help" to see available commands')
  this.log()
  this.exit(1)
}

export default hook
