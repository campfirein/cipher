#!/usr/bin/env node

/**
 * Gracefully stops the running brv daemon.
 *
 * Uses the daemon.json PID tracking from brv-transport-client
 * instead of brute-force pkill. Sends SIGTERM first, then
 * falls back to SIGKILL after the stop budget (3s).
 *
 * Usage:
 *   node bin/kill-daemon.js          # graceful stop
 *   npm run dev:kill                 # via npm script
 *   npm run dev                      # kill + build + run (full cycle)
 */

import {
  DAEMON_STOP_BUDGET_MS,
  DAEMON_STOP_POLL_INTERVAL_MS,
  discoverDaemon,
  isProcessAlive,
} from '@campfirein/brv-transport-client'

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function waitForProcessExit(pid, deadlineMs, pollMs) {
  const deadline = Date.now() + deadlineMs
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      return true
    }

    // eslint-disable-next-line no-await-in-loop
    await sleep(pollMs)
  }

  return false
}

const status = discoverDaemon()

// Extract PID from any discovery result that has one
const pid = status.running
  ? status.pid
  : 'pid' in status
    ? status.pid
    : undefined

if (pid === undefined || !isProcessAlive(pid)) {
  console.log('[kill-daemon] No running daemon found')
} else {
  console.log(`[kill-daemon] Stopping daemon (PID ${pid})...`)

  let stopped = false

  // Step 1: SIGTERM for graceful shutdown
  try {
    process.kill(pid, 'SIGTERM')
    stopped = await waitForProcessExit(pid, DAEMON_STOP_BUDGET_MS, DAEMON_STOP_POLL_INTERVAL_MS)
  } catch {
    stopped = true
  }

  if (stopped) {
    console.log('[kill-daemon] Daemon stopped gracefully')
  } else {
    // Step 2: SIGKILL fallback
    try {
      process.kill(pid, 'SIGKILL')
      console.log('[kill-daemon] Force killed daemon (SIGKILL)')
    } catch {
      console.log('[kill-daemon] Daemon stopped')
    }
  }
}
