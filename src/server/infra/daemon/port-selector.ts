import {DAEMON_PORT_RANGE_MAX, DAEMON_PORT_RANGE_MIN, DAEMON_PREFERRED_PORT} from '../../constants.js'
import {isPortAvailable} from '../transport/port-utils.js'

export type SelectDaemonPortResult =
  | {port: number; success: true}
  | {reason: 'all_ports_occupied'; success: false}

/**
 * Selects a port for the daemon server.
 *
 * Strategy: deterministic sequential scan in narrow range for predictability.
 * 1. Try preferred port (37847)
 * 2. Scan 37848–37947 sequentially
 * 3. Return failure if entire range exhausted
 *
 * Unlike findAvailablePort() which uses random ports in 49152-60000,
 * this uses a narrow deterministic range so clients can find the daemon.
 */
export async function selectDaemonPort(): Promise<SelectDaemonPortResult> {
  // Try preferred port first
  if (await isPortAvailable(DAEMON_PREFERRED_PORT)) {
    return {port: DAEMON_PREFERRED_PORT, success: true}
  }

  // Sequential scan through fallback range
  for (let port = DAEMON_PORT_RANGE_MIN; port <= DAEMON_PORT_RANGE_MAX; port++) {
    // eslint-disable-next-line no-await-in-loop -- Sequential check is intentional
    if (await isPortAvailable(port)) {
      return {port, success: true}
    }
  }

  return {reason: 'all_ports_occupied', success: false}
}
