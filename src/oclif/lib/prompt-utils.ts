import chalk from 'chalk'

/**
 * Shared theme for select prompts in interactive wizards.
 * Appends "esc back" to the built-in key help tip (↑↓ navigate • ⏎ select).
 */
export const wizardSelectTheme = {
  style: {
    keysHelpTip: (keys: [string, string][]) =>
      [...keys, ['esc', 'cancel']].map(([key, action]) => `${key} ${chalk.dim(action)}`).join(chalk.dim(' • ')),
  },
}

/**
 * Shared theme for input/password prompts in interactive wizards.
 * Appends "esc back" hint to the message line.
 */
export const wizardInputTheme = {
  style: {
    message(text: string, status: string) {
      const base = chalk.bold(text)
      return status === 'done' ? base : `${chalk.bold(text)} ${chalk.dim('(esc back)')}`
    },
  },
}

/** Esc key — go back to previous step */
export function isEscBack(error: unknown): boolean {
  // @inquirer/prompts error class names as of v7
  return error instanceof Error && error.name === 'AbortPromptError'
}

/** Ctrl+C — exit the wizard entirely */
export function isForceExit(error: unknown): boolean {
  // @inquirer/prompts error class names as of v7
  return error instanceof Error && (error.name === 'ExitPromptError' || error.name === 'CancelPromptError')
}

/** Any prompt cancellation (Esc or Ctrl+C) */
export function isPromptCancelled(error: unknown): boolean {
  return isEscBack(error) || isForceExit(error)
}

/**
 * Validates a URL string.
 * @param value The URL string to validate.
 * @returns True if the URL is valid, otherwise an error message.
 */
export function validateUrl(value: string): boolean | string {
  let parsed: undefined | URL
  try {
    parsed = new URL(value)
  } catch {
    return `Invalid base URL format: "${value}". Must be a valid http:// or https:// URL.`
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return 'URL must start with http:// or https://'
  }

  return true
}

/**
 * Creates an AbortSignal that aborts when Escape is pressed.
 * Use with @inquirer/prompts to enable Esc-to-go-back in interactive wizards.
 *
 * - `signal` — pass to prompt's context `{signal}` to make it cancellable
 * - `reset()` — create a fresh AbortController after a cancel (signal is single-use)
 * - `cleanup()` — remove the keypress listener when the wizard is done
 */
export function createEscapeSignal(): {cleanup: () => void; reset: () => void; signal: AbortSignal} {
  let controller = new AbortController()

  const onKeypress = (_ch: string, key?: {name?: string}) => {
    if (key?.name === 'escape') {
      controller.abort()
    }
  }

  if (process.stdin.isTTY) {
    process.stdin.on('keypress', onKeypress)
  }

  return {
    cleanup() {
      process.stdin.removeListener('keypress', onKeypress)
    },
    reset() {
      controller = new AbortController()
    },
    get signal() {
      return controller.signal
    },
  }
}
