import {createServer} from 'node:net'

import {TRANSPORT_HOST} from '../../constants.js'

/**
 * Checks if a port is available for binding.
 *
 * @param port - The port number to check
 * @returns Promise resolving to true if available, false otherwise
 */
export function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()

    server.once('error', () => {
      resolve(false)
    })

    server.once('listening', () => {
      server.close(() => {
        resolve(true)
      })
    })

    server.listen(port, TRANSPORT_HOST)
  })
}
