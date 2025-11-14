import type {CommandValidation, ProcessConfig} from '../../../core/domain/cipher/process/types.js'

/**
 * Maximum allowed command length (characters).
 */
const MAX_COMMAND_LENGTH = 10_000

/**
 * Dangerous patterns that should always be blocked or require approval.
 *
 * These patterns match commands that could cause system damage, data loss,
 * or security breaches.
 */
const DANGEROUS_PATTERNS: RegExp[] = [
  // File system destruction
  /rm\s+-rf\s+\//i,
  /rm\s+-fr\s+\//i,
  /rm\s+--recursive\s+--force\s+\//i,
  /rm\s+-r\s+\//i,
  /rm\s+\//,
  /mkfs/i,
  /fdisk\s+\/dev\/sd[a-z]/i,

  // Fork bombs
  /:(\(\)|\{)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,

  // Disk operations
  /dd\s+if=\/dev\/zero\s+of=\/dev\/sd[a-z]/i,
  /dd\s+if=\/dev\/random\s+of=\/dev\/sd[a-z]/i,
  /dd\s+if=\/dev\/urandom\s+of=\/dev\/sd[a-z]/i,
  /dd.*of=\/dev\/sd[a-z]/i,

  // Download and execute
  /(curl|wget)\s+.*\|\s*(sh|bash|zsh|fish|python|perl|ruby|node)/i,
  /(curl|wget)\s+.*>\s*\/tmp\/.*&&\s*(sh|bash|zsh|fish|python|perl|ruby|node)/i,

  // Permission changes on root
  /chmod\s+777\s+\//i,
  /chmod\s+-R\s+777\s+\//i,
  /chown\s+-R\s+root\s+\//i,

  // System shutdown/reboot
  /shutdown\s+(now|-h|-r)/i,
  /reboot/i,
  /halt/i,
  /poweroff/i,
  /init\s+[06]/,

  // Network manipulation
  /ifconfig\s+\w+\s+down/i,
  /ip\s+link\s+set\s+\w+\s+down/i,

  // Kernel manipulation
  /insmod/i,
  /rmmod/i,
  /modprobe\s+-r/i,

  // Package system damage
  /rpm\s+-e\s+--nodeps\s+glibc/i,
  /dpkg\s+-r\s+--force-all\s+libc/i,
  /apt-get\s+remove\s+--force-yes\s+libc/i,

  // Filling disk
  /while\s+true.*dd/i,
  /yes\s+>\s*\/dev\/sd[a-z]/i,

  // Process bombing
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\};\s*:/,

  // System file deletion
  /rm\s+-rf?\s+(\/bin|\/sbin|\/usr|\/lib|\/lib64|\/etc|\/var|\/opt|\/boot|\/sys|\/proc)/i,

  // Overwriting critical files
  />\s*\/etc\/(passwd|shadow|sudoers|fstab|hosts)/i,
  /cat\s+>>\s*\/etc\/(passwd|shadow|sudoers)/i,
]

/**
 * Command injection patterns that indicate unsafe command construction.
 *
 * These patterns detect attempts to chain commands, substitute commands,
 * or manipulate the shell in unsafe ways.
 */
const INJECTION_PATTERNS: RegExp[] = [
  // Command chaining with dangerous commands
  /;\s*(rm|mv|cp|chmod|chown|dd|mkfs|fdisk)/i,
  /&&\s*(rm|mv|cp|chmod|chown|dd|mkfs|fdisk)/i,
  /\|\|\s*(rm|mv|cp|chmod|chown|dd|mkfs|fdisk)/i,

  // Command substitution with dangerous commands
  /`.*rm.*`/i,
  /\$\(.*rm.*\)/i,
  /`.*chmod.*`/i,
  /\$\(.*chmod.*\)/i,

  // Multiple command separators
  /;\s*;/,
  /&&\s*&&/,
  /\|\|\s*\|\|/,

  // Redirection with dangerous patterns
  /rm.*>\s*\/dev\/null\s*2>&1/i,
  /chmod.*>\s*\/dev\/null\s*2>&1/i,

  // Background execution of dangerous commands
  /&\s*(rm|chmod|chown|dd)/i,

  // Environment variable manipulation
  /export\s+PATH=.*;\s*(rm|chmod)/i,
  /PATH=.*\s+(rm|chmod)/i,
]

/**
 * Safe patterns that are explicitly allowed even in strict mode.
 *
 * These patterns match common, safe operations that don't pose
 * security risks.
 */
const SAFE_PATTERNS: RegExp[] = [
  // Safe directory navigation
  /^cd\s+[^;|&]+\s*&&\s*/,

  // Safe pipes
  /\|\s*grep/,
  /\|\s*awk/,
  /\|\s*sed/,
  /\|\s*sort/,
  /\|\s*uniq/,
  /\|\s*head/,
  /\|\s*tail/,
  /\|\s*wc/,
  /\|\s*less/,
  /\|\s*more/,

  // Safe redirections
  /ls\s+.*>/,
  /echo\s+.*>/,
  /cat\s+.*>/,
  /find\s+.*>/,

  // Read-only git operations
  /git\s+(status|log|diff|show|branch|tag|fetch|pull)(?!\s+-)/i,
]

/**
 * Command validator for security and safety checks.
 *
 * Validates commands against dangerous patterns, injection attacks,
 * and approval requirements based on security level.
 */
export class CommandValidator {
  private readonly config: Pick<ProcessConfig, 'allowedCommands' | 'blockedCommands' | 'securityLevel'>

  /**
   * Creates a new command validator.
   *
   * @param config - Process configuration for security settings
   */
  public constructor(
    config: Pick<ProcessConfig, 'allowedCommands' | 'blockedCommands' | 'securityLevel'>,
  ) {
    this.config = config
  }

  /**
   * Get the list of allowed commands.
   *
   * @returns Array of allowed command patterns
   */
  public getAllowedCommands(): string[] {
    return [...this.config.allowedCommands]
  }

  /**
   * Get the list of blocked commands.
   *
   * @returns Array of blocked command patterns
   */
  public getBlockedCommands(): string[] {
    return [...this.config.blockedCommands]
  }

  /**
   * Get the current security level.
   *
   * @returns Security level setting
   */
  public getSecurityLevel(): string {
    return this.config.securityLevel
  }

  /**
   * Validate a command for security and safety.
   *
   * Performs multiple checks:
   * 1. Empty command check
   * 2. Length limit check
   * 3. Dangerous pattern detection
   * 4. Injection detection
   * 5. Blocked/allowed command list checks
   * 6. Approval requirement determination
   *
   * @param command - Command string to validate
   * @returns Validation result with approval requirement
   */
  public validateCommand(command: string): CommandValidation {
    // 1. Check for empty command
    const trimmed = command.trim()
    if (!trimmed) {
      return {
        error: 'Command cannot be empty',
        isValid: false,
      }
    }

    // 2. Check command length
    if (trimmed.length > MAX_COMMAND_LENGTH) {
      return {
        error: `Command exceeds maximum length of ${MAX_COMMAND_LENGTH} characters`,
        isValid: false,
      }
    }

    // 3. Check dangerous patterns (strict/moderate only)
    if (this.config.securityLevel !== 'permissive') {
      for (const pattern of DANGEROUS_PATTERNS) {
        if (pattern.test(trimmed)) {
          return {
            error: `Command matches dangerous pattern: ${pattern.source}`,
            isValid: false,
          }
        }
      }
    }

    // 4. Check for command injection
    const injectionResult = this.detectInjection(trimmed)
    if (!injectionResult.isValid) {
      return injectionResult
    }

    // 5. Check blocked commands list
    const commandName = trimmed.split(/\s+/)[0]
    if (this.config.blockedCommands.some(blocked => trimmed.includes(blocked))) {
      return {
        error: `Command is in the blocked list`,
        isValid: false,
      }
    }

    // 6. Check allowed commands list (if not empty)
    if (this.config.allowedCommands.length > 0) {
      const isAllowed = this.config.allowedCommands.some(
        allowed => commandName === allowed || trimmed.startsWith(allowed),
      )
      if (!isAllowed) {
        return {
          error: `Command not in allowed list`,
          isValid: false,
        }
      }
    }

    return {
      isValid: true,
      normalizedCommand: trimmed,
    }
  }

  /**
   * Detect command injection patterns.
   *
   * Checks for unsafe command chaining, substitution, and other
   * injection attack vectors.
   *
   * @param command - Command to check
   * @returns Validation result
   */
  private detectInjection(command: string): CommandValidation {
    // Check against known injection patterns
    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(command)) {
        return {
          error: `Command injection detected: ${pattern.source}`,
          isValid: false,
        }
      }
    }

    // In strict mode, block multiple commands unless explicitly safe
    if (this.config.securityLevel === 'strict') {
      const hasMultipleCommands = /[;|&]/.test(command)
      if (hasMultipleCommands) {
        // Check if it matches a safe pattern
        const isSafe = SAFE_PATTERNS.some(pattern => pattern.test(command))
        if (!isSafe) {
          return {
            error: 'Multiple commands or pipes not allowed in strict mode',
            isValid: false,
          }
        }
      }
    }

    return {
      isValid: true,
      normalizedCommand: command,
    }
  }
}
