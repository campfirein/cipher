const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

/**
 * Minimal stderr spinner that erases itself when cleared.
 * Shows a spinning animation with a message, disappears completely on clear().
 * No-op in non-TTY environments (CI, pipes).
 */
export function createSpinner(message: string): {clear: () => void} {
  if (!process.stderr.isTTY) {
    return {clear() {}}
  }

  let frameIndex = 0
  const interval = setInterval(() => {
    const frame = SPINNER_FRAMES[frameIndex % SPINNER_FRAMES.length]
    process.stderr.write(`\r${frame} ${message}`)
    frameIndex++
  }, 80)

  return {
    clear() {
      clearInterval(interval)
      process.stderr.write('\r\u001B[2K')
    },
  }
}
