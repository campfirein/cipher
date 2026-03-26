export const ESC_HINT = '(esc to go back)'

export function isPromptCancelled(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortPromptError' || error.name === 'CancelPromptError' || error.name === 'ExitPromptError')
  )
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
