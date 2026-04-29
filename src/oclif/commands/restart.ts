import {
  DAEMON_INSTANCE_FILE,
  ensureDaemonRunning,
  getGlobalDataDir,
  GlobalInstanceManager,
  HEARTBEAT_FILE,
  SPAWN_LOCK_FILE,
} from '@campfirein/brv-transport-client'
import {Command} from '@oclif/core'
import {spawnSync} from 'node:child_process'
import {readdirSync, readFileSync, unlinkSync} from 'node:fs'
import {dirname, join, resolve} from 'node:path'

import {resolveLocalServerMainPath} from '../../server/utils/server-main-resolver.js'

const KILL_SETTLE_MS = 500
const KILL_VERIFY_TIMEOUT_MS = 5000
const KILL_VERIFY_POLL_MS = 100
const SIGTERM_BUDGET_MS = 8000

/**
 * Grace period after the new daemon's transport is listening, to give the
 * agent-pool time to initialize before the next command lands. Doesn't
 * eliminate the agent-registration race (that's a server-side fix), but
 * removes most of the window we hit on Anthropic in exp 03 v3.
 */
const DAEMON_WARMUP_MS = 1500

export default class Restart extends Command {
  static description = `Restart ByteRover — stop everything and start fresh.

Run this when ByteRover is unresponsive, stuck, or after installing an update.
All open sessions and background processes are stopped.
The daemon will restart automatically on the next brv command.`
  static examples = ['<%= config.bin %> <%= command.id %>']
  /** Commands whose processes must not be killed (e.g. `brv update` calls `brv restart`). */
  private static readonly PROTECTED_COMMANDS = ['update']
  /** Server/agent patterns — cannot match CLI processes, no self-kill risk. */
  private static readonly SERVER_AGENT_PATTERNS = ['brv-server.js', 'agent-process.js']

  /**
   * Builds the list of CLI script patterns used to identify brv client processes.
   *
   * All patterns are absolute paths or specific filenames to avoid false-positive matches
   * against other oclif CLIs (which also use bin/run.js and bin/dev.js conventions).
   *
   * CLI script patterns (covers all installations):
   *   dev mode (bin/dev.js):       join(brvBinDir, 'dev.js') — absolute path, same installation only
   *   build/dev (bin/run.js):      join(brvBinDir, 'run.js')
   *   global install (npm / tgz):  byterover-cli/bin/run.js — package name in node_modules is fixed
   *   bundled binary (oclif pack): join('bin', 'brv') + argv1
   *   nvm / system global:         cmdline = node .../bin/brv  ← caught by 'bin/brv' substring
   *   curl install (/.brv-cli/):   join(brvBinDir, 'run') — entry point named 'run' without .js
   *
   * Set deduplicates when paths overlap (e.g. process.argv[1] is already run.js).
   */
  static buildCliPatterns(): string[] {
    const argv1 = resolve(process.argv[1])
    const brvBinDir = dirname(argv1)
    return [
      ...new Set([
        argv1,
        join('bin', 'brv'),
        join('byterover-cli', 'bin', 'run.js'),
        join(brvBinDir, 'dev.js'),
        join(brvBinDir, 'run'), // curl install: entry point named 'run' without .js suffix
        join(brvBinDir, 'run.js'),
      ]),
    ]
  }

  /**
   * Returns true if the cmdline contains a protected command as an argument.
   * Handles both /proc null-byte delimiters (Linux) and space delimiters (macOS ps).
   */
  private static isProtectedCommand(cmdline: string): boolean {
    return Restart.PROTECTED_COMMANDS.some(
      (cmd) =>
        // Linux /proc/cmdline: null-byte delimited
        cmdline.includes(`\0${cmd}\0`) ||
        cmdline.endsWith(`\0${cmd}`) ||
        // macOS ps / Windows: space delimited
        cmdline.endsWith(` ${cmd}`) ||
        cmdline.includes(` ${cmd} `),
    )
  }

  /**
   * Kill a process by PID.
   * - Unix: SIGKILL via process.kill() — immediate, no graceful shutdown
   * - Windows: taskkill /f /t — force tree-kill (also kills agent children)
   */
  private static killByPid(pid: number): void {
    try {
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/pid', String(pid), '/f', '/t'], {stdio: 'ignore'})
      } else {
        process.kill(pid, 'SIGKILL')
      }
    } catch {
      // Process already dead — ignore
    }
  }

  /**
   * Kill matching brv processes on Linux by scanning /proc/<pid>/cmdline.
   * Simple substring match — no cwd resolution needed.
   * Works on all Linux distros including Alpine — /proc is a kernel feature.
   */
  private static killByProcScan(patterns: string[], excludePids: Set<number>, skipProtected: boolean): void {
    let entries: string[]
    try {
      entries = readdirSync('/proc')
    } catch {
      return // /proc not available — skip
    }

    for (const entry of entries) {
      const pid = Number.parseInt(entry, 10)
      if (Number.isNaN(pid) || excludePids.has(pid)) continue
      try {
        const cmdline = readFileSync(join('/proc', entry, 'cmdline'), 'utf8')
        if (patterns.some((p) => cmdline.includes(p))) {
          if (skipProtected && Restart.isProtectedCommand(cmdline)) continue
          process.kill(pid, 'SIGKILL')
        }
      } catch {
        // Process exited or permission denied — ignore
      }
    }
  }

  /**
   * Kill matching brv processes on macOS by scanning all processes via `ps`.
   * Simple substring match — no cwd resolution needed because patterns
   * are either unique filenames (brv-server.js) or absolute paths.
   */
  private static killByPsScan(patterns: string[], excludePids: Set<number>, skipProtected: boolean): void {
    const psResult = spawnSync('ps', ['-A', '-o', 'pid,args'], {encoding: 'utf8'})
    if (!psResult.stdout) return

    for (const line of psResult.stdout.split('\n').slice(1)) {
      const match = /^\s*(\d+)\s+(.+)$/.exec(line)
      if (!match) continue
      const pid = Number.parseInt(match[1], 10)
      const cmdline = match[2]
      if (Number.isNaN(pid) || excludePids.has(pid)) continue

      if (patterns.some((p) => cmdline.includes(p))) {
        if (skipProtected && Restart.isProtectedCommand(cmdline)) continue
        try {
          process.kill(pid, 'SIGKILL')
        } catch {
          // Process already dead — ignore
        }
      }
    }
  }

  /**
   * Pattern-kill brv processes matching the given patterns.
   *
   * Self-exclusion: own PID and parent PID are always filtered out.
   * The parent PID exclusion protects the oclif bin/brv bash wrapper
   * on bundled installs (it does not use exec, so bash remains as parent).
   *
   * When skipProtected is true, processes running protected commands
   * (e.g. `brv update`) are spared — prevents `brv restart` from killing
   * the `brv update` process that invoked it.
   *
   * OS dispatch:
   *   Linux (incl. Alpine, WSL2): /proc scan
   *   macOS:                      ps -A scan
   *   Windows:                    PowerShell Get-CimInstance — available Windows 8+ / PS 3.0+
   */
  private static patternKill(patterns: string[], skipProtected = false): void {
    const excludePids = new Set([process.pid, process.ppid])

    if (process.platform === 'win32') {
      const whereClause = patterns.map((p) => `$_.CommandLine -like '*${p.replaceAll("'", "''")}*'`).join(' -or ')
      const protectedClause = skipProtected
        ? ` -and ${Restart.PROTECTED_COMMANDS.map((cmd) => `$_.CommandLine -notlike '* ${cmd} *' -and $_.CommandLine -notlike '* ${cmd}'`).join(' -and ')}`
        : ''
      const script = `Get-CimInstance Win32_Process | Where-Object { (${whereClause}) -and $_.ProcessId -ne ${process.pid} -and $_.ProcessId -ne ${process.ppid}${protectedClause} } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`
      spawnSync('powershell', ['-Command', script], {stdio: 'ignore'})
    } else if (process.platform === 'linux') {
      Restart.killByProcScan(patterns, excludePids, skipProtected)
    } else {
      // macOS (and other Unix): ps -A scan
      Restart.killByPsScan(patterns, excludePids, skipProtected)
    }
  }

  private static sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms)
    })
  }

  /**
   * Polls until the process is dead, returning true if it exited within the timeout.
   * Uses `process.kill(pid, 0)` — sends no signal, just checks existence.
   * On ESRCH the PID is confirmed dead.
   */
  private static async waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      try {
        process.kill(pid, 0)
      } catch {
        return true // ESRCH = dead
      }

      // eslint-disable-next-line no-await-in-loop -- intentional poll loop
      await Restart.sleep(KILL_VERIFY_POLL_MS)
    }

    return false
  }

  protected cleanupAllDaemonFiles(dataDir: string): void {
    for (const file of [DAEMON_INSTANCE_FILE, HEARTBEAT_FILE, SPAWN_LOCK_FILE]) {
      try {
        unlinkSync(join(dataDir, file))
      } catch {
        // File may not exist — ignore
      }
    }
  }

  protected exitProcess(code: number): void {
    // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
    process.exit(code)
  }

  protected loadDaemonInfo(dataDir: string): undefined | {pid: number; port: number} {
    return new GlobalInstanceManager({dataDir}).load()
  }

  async run(): Promise<void> {
    const dataDir = getGlobalDataDir()

    // Phase 1: Kill all client processes first (TUI, MCP, headless commands).
    // Must happen BEFORE daemon kill — clients have reconnectors that will
    // respawn the daemon via ensureDaemonRunning() if they detect disconnection.
    // Self excluded by process.pid / process.ppid.
    // Protected commands (e.g. `brv update`) are spared.
    this.log('Stopping clients...')
    Restart.patternKill(Restart.buildCliPatterns(), true)
    await Restart.sleep(KILL_SETTLE_MS)

    // Phase 2: Graceful daemon kill via daemon.json PID.
    // SIGTERM triggers ShutdownHandler → stops agents, transport, releases daemon.json.
    // Safe now because all clients are dead — no one can respawn daemon.
    const info = this.loadDaemonInfo(dataDir)
    if (info !== undefined) {
      this.log(`Stopping daemon (PID ${info.pid})...`)

      let stopped = false
      try {
        process.kill(info.pid, 'SIGTERM')
        stopped = await Restart.waitForProcessExit(info.pid, SIGTERM_BUDGET_MS)
      } catch {
        stopped = true // ESRCH = already dead
      }

      if (!stopped) {
        Restart.killByPid(info.pid)
        if (process.platform !== 'win32') {
          await Restart.waitForProcessExit(info.pid, KILL_VERIFY_TIMEOUT_MS)
        }
      }
    }

    // Phase 3: Kill orphaned server/agent processes not tracked in daemon.json.
    Restart.patternKill(Restart.SERVER_AGENT_PATTERNS)
    await Restart.sleep(KILL_SETTLE_MS)

    // Phase 4: Clean state files.
    this.cleanupAllDaemonFiles(dataDir)

    this.log('All ByteRover processes stopped.')

    // Phase 5: Spawn a fresh daemon and wait for it to be ready BEFORE
    // returning control. Without this, the next user command (e.g.
    // `brv curate ...` immediately after `brv restart`) races daemon
    // spawn + agent-pool initialization and intermittently hits "Agent
    // disconnected" — observed during exp 03 v3 / exp 04 batch runs on
    // Anthropic, where the daemon-readiness race surfaced on the two
    // largest fixtures.
    this.log('Starting fresh daemon...')
    const spawnResult = await ensureDaemonRunning({
      serverPath: resolveLocalServerMainPath(),
      version: this.config.version,
    })
    if (spawnResult.success) {
      // Brief warmup pause so the agent-pool inside the new daemon has
      // a head start on initialization before the first user command.
      await Restart.sleep(DAEMON_WARMUP_MS)
      this.log('Daemon ready.')
    } else {
      // Don't fail restart if respawn didn't succeed — old behavior was
      // "next command will spawn it." Log the issue and exit anyway.
      const detail = spawnResult.spawnError ? `: ${spawnResult.spawnError}` : ''
      this.log(`Note: daemon did not spawn cleanly${detail}. Next brv command will retry.`)
    }

    // Force exit — oclif does not call process.exit() after run() returns,
    // relying on the event loop to drain. Third-party plugin hooks (e.g.
    // @oclif/plugin-update) can leave open handles that prevent exit.
    this.exitProcess(0)
  }
}
