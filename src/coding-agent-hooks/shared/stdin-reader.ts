/**
 * Stdin Reader Utility
 *
 * Shared utility for reading from stdin with timeout and error handling.
 * Used by Claude Code hooks to receive JSON input from the IDE.
 */

import {MAX_STDIN_SIZE, STDIN_TIMEOUT_MS} from './constants.js'

/**
 * Read all data from stdin with timeout and error handling.
 *
 * Features:
 * - Configurable timeout (default: 5 seconds)
 * - Proper error event handling
 * - Automatic cleanup of event listeners and timeout
 *
 * @param timeoutMs - Timeout in milliseconds (default: 5000ms)
 * @returns Promise resolving to stdin content
 * @throws Error if stdin times out or encounters an error
 *
 * @example
 * try {
 *   const input = await readStdin()
 *   const data = JSON.parse(input)
 * } catch (error) {
 *   console.error('Failed to read stdin:', error)
 * }
 */
export const readStdin = async (timeoutMs: number = STDIN_TIMEOUT_MS): Promise<string> =>
  new Promise((resolve, reject) => {
    let data = ''

    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error(`stdin timeout after ${timeoutMs}ms`))
    }, timeoutMs)

    const cleanup = () => {
      clearTimeout(timeout)
      process.stdin.removeListener('data', onData)
      process.stdin.removeListener('end', onEnd)
      process.stdin.removeListener('error', onError)
    }

    const onData = (chunk: string) => {
      if (data.length + chunk.length > MAX_STDIN_SIZE) {
        cleanup()
        reject(new Error(`stdin input exceeded maximum size of ${MAX_STDIN_SIZE} bytes`))
        return
      }

      data += chunk
    }

    const onEnd = () => {
      cleanup()
      resolve(data)
    }

    const onError = (err: Error) => {
      cleanup()
      reject(err)
    }

    process.stdin.setEncoding('utf8')
    process.stdin.on('data', onData)
    process.stdin.on('end', onEnd)
    process.stdin.on('error', onError)
  })
