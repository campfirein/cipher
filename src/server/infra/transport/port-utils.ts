import {createServer} from 'node:net'

import {TRANSPORT_HOST} from '../../constants.js'

/**
 * Port range for transport server.
 * Using high ports (49152-65535) which are "dynamic/private" per IANA.
 * We use a subset to avoid potential conflicts.
 */
const PORT_RANGE_MIN = 49_152
const PORT_RANGE_MAX = 60_000

/**
 * Maximum attempts to find an available port.
 */
const MAX_PORT_ATTEMPTS = 20

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

/**
 * Generates a random port within the safe range.
 *
 * @returns A random port number between PORT_RANGE_MIN and PORT_RANGE_MAX
 */
export function getRandomPort(): number {
  return Math.floor(Math.random() * (PORT_RANGE_MAX - PORT_RANGE_MIN + 1)) + PORT_RANGE_MIN
}

/**
 * Finds an available port for the transport server.
 *
 * Uses a random selection strategy within the safe port range (49152-60000)
 * to avoid conflicts with:
 * - Well-known ports (0-1023): HTTP, HTTPS, SSH, etc.
 * - Common dev ports: 3000, 5000, 8080, etc.
 * - Database ports: 3306, 5432, 27017, 6379, etc.
 *
 * @returns Promise resolving to an available port number
 * @throws Error if no available port found after MAX_PORT_ATTEMPTS
 *
 * @example
 * const port = await findAvailablePort();
 * await server.start(port);
 */
export async function findAvailablePort(): Promise<number> {
  for (let attempt = 0; attempt < MAX_PORT_ATTEMPTS; attempt++) {
    const port = getRandomPort()
    // eslint-disable-next-line no-await-in-loop -- Sequential check is intentional: find first available port
    if (await isPortAvailable(port)) {
      return port
    }
  }

  throw new Error(
    `Failed to find available port after ${MAX_PORT_ATTEMPTS} attempts in range ${PORT_RANGE_MIN}-${PORT_RANGE_MAX}`,
  )
}

/**
 * Finds an available port, starting from a preferred port.
 * If the preferred port is not available, falls back to random selection.
 *
 * @param preferredPort - The preferred port to try first
 * @returns Promise resolving to an available port number
 *
 * @example
 * // Try 37847 first, fallback to random if unavailable
 * const port = await findAvailablePortWithPreference(37847);
 */
export async function findAvailablePortWithPreference(preferredPort: number): Promise<number> {
  if (await isPortAvailable(preferredPort)) {
    return preferredPort
  }

  return findAvailablePort()
}
