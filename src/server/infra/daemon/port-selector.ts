import {DYNAMIC_PORT_MAX, DYNAMIC_PORT_MIN, PORT_BATCH_SIZE, PORT_MAX_ATTEMPTS} from '../../constants.js'
import {isPortAvailable} from '../transport/port-utils.js'

export type SelectDaemonPortResult =
  | {port: number; success: true}
  | {reason: 'all_ports_occupied'; success: false}

export type PortSelectionOptions = {
  batchSize?: number
  checker?: (port: number) => Promise<boolean>
  maxAttempts?: number
  portMax?: number
  portMin?: number
}

/**
 * Generates an array of unique random port numbers within the given range.
 */
function generateRandomPorts(count: number, min: number, max: number): number[] {
  const range = max - min + 1
  const safeCount = Math.min(count, range)
  const ports = new Set<number>()

  while (ports.size < safeCount) {
    ports.add(min + Math.floor(Math.random() * range))
  }

  return [...ports]
}

/**
 * Selects a port for the daemon server using parallel batch checking.
 *
 * Strategy: random batch parallel scan across dynamic port range (49152-65535).
 * 1. Generate a batch of random candidate ports
 * 2. Check all candidates in parallel
 * 3. Return first available port
 * 4. If none available, repeat with a new batch
 * 5. Return failure after max attempts exhausted
 *
 * Uses IANA dynamic/private port range (49152-65535) for cross-platform
 * compatibility (macOS, Windows, Linux, WSL, WSL2, Docker).
 */
export async function selectDaemonPort(options?: PortSelectionOptions): Promise<SelectDaemonPortResult> {
  const portMin = options?.portMin ?? DYNAMIC_PORT_MIN
  const portMax = options?.portMax ?? DYNAMIC_PORT_MAX
  const batchSize = options?.batchSize ?? PORT_BATCH_SIZE
  const maxAttempts = options?.maxAttempts ?? PORT_MAX_ATTEMPTS
  const checker = options?.checker ?? isPortAvailable

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidates = generateRandomPorts(batchSize, portMin, portMax)

    // Check all candidates in parallel for speed
    // eslint-disable-next-line no-await-in-loop
    const results = await Promise.all(
      candidates.map(async (port) => ({available: await checker(port), port})),
    )

    const found = results.find((r) => r.available)
    if (found) {
      return {port: found.port, success: true}
    }
  }

  return {reason: 'all_ports_occupied', success: false}
}
