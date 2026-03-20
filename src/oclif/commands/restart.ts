import {
  DAEMON_INSTANCE_FILE,
  getGlobalDataDir,
  GlobalInstanceManager,
  HEARTBEAT_FILE,
  SPAWN_LOCK_FILE,
} from '@campfirein/brv-transport-client'
import {Command} from '@oclif/core'
import {spawnSync} from 'node:child_process'
import {readdirSync, readFileSync, unlinkSync} from 'node:fs'
import {dirname, join} from 'node:path'

const KILL_SETTLE_MS = 500
const KILL_VERIFY_TIMEOUT_MS = 5000
const KILL_VERIFY_POLL_MS = 100
const SIGTERM_BUDGET_MS = 8000

export default class Restart extends Command {
  static description = `Restart ByteRover — stop everything and start fresh.

Run this when ByteRover is unresponsive, stuck, or after installing an update.
All open sessions and background processes are stopped.
The daemon will restart automatically on the next brv command.`
  static examples = ['<%= config.bin %> <%= command.id %>']
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
    const brvBinDir = dirname(process.argv[1])
    return [
      ...new Set([
        join('bin', 'brv'),
        join('byterover-cli', 'bin', 'run.js'),
        join(brvBinDir, 'dev.js'),
        join(brvBinDir, 'run'), // curl install: entry point named 'run' without .js suffix
        join(brvBinDir, 'run.js'),
        process.argv[1],
      ]),
    ]
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
  private static killByProcScan(patterns: string[], excludePids: Set<number>): void {
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
  private static killByPsScan(patterns: string[], excludePids: Set<number>): void {
    const psResult = spawnSync('ps', ['-A', '-o', 'pid,args'], {encoding: 'utf8'})
    if (!psResult.stdout) return

    for (const line of psResult.stdout.split('\n').slice(1)) {
      const match = /^\s*(\d+)\s+(.+)$/.exec(line)
      if (!match) continue
      const pid = Number.parseInt(match[1], 10)
      const cmdline = match[2]
      if (Number.isNaN(pid) || excludePids.has(pid)) continue

      if (patterns.some((p) => cmdline.includes(p))) {
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
   * OS dispatch:
   *   Linux (incl. Alpine, WSL2): /proc scan
   *   macOS:                      ps -A scan
   *   Windows:                    PowerShell Get-CimInstance — available Windows 8+ / PS 3.0+
   */
  private static patternKill(patterns: string[]): void {
    const excludePids = new Set([process.pid, process.ppid])

    if (process.platform === 'win32') {
      const whereClause = patterns.map((p) => `$_.CommandLine -like '*${p}*'`).join(' -or ')
      const script = `Get-CimInstance Win32_Process | Where-Object { (${whereClause}) -and $_.ProcessId -ne ${process.pid} -and $_.ProcessId -ne ${process.ppid} } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`
      spawnSync('powershell', ['-Command', script], {stdio: 'ignore'})
    } else if (process.platform === 'linux') {
      Restart.killByProcScan(patterns, excludePids)
    } else {
      // macOS (and other Unix): ps -A scan
      Restart.killByPsScan(patterns, excludePids)
    }
  }

  private static sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms)
    })
  }

  /**
   * Polls until the process with the given PID is no longer alive.
   * Uses `process.kill(pid, 0)` — sends no signal, just checks existence.
   * On ESRCH the PID is confirmed dead.
   */
  private static async waitForPidToDie(pid: number, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      try {
        process.kill(pid, 0) // throws ESRCH if dead
      } catch {
        return // process confirmed dead
      }

      // eslint-disable-next-line no-await-in-loop -- intentional poll loop
      await Restart.sleep(KILL_VERIFY_POLL_MS)
    }
    // Timed out — continue anyway
  }

  /**
   * Polls until the process is dead, returning true if it exited.
   * Used for SIGTERM → SIGKILL flow where we need to know whether
   * graceful shutdown succeeded before falling back to force kill.
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

  async run(): Promise<void> {
    const dataDir = getGlobalDataDir()

    // Phase 1: Kill all client processes first (TUI, MCP, headless commands).
    // Must happen BEFORE daemon kill — clients have reconnectors that will
    // respawn the daemon via ensureDaemonRunning() if they detect disconnection.
    // Self excluded by process.pid / process.ppid.
    this.log('Stopping clients...')
    Restart.patternKill(Restart.buildCliPatterns())
    await Restart.sleep(KILL_SETTLE_MS)

    // Phase 2: Graceful daemon kill via daemon.json PID.
    // SIGTERM triggers ShutdownHandler → stops agents, transport, releases daemon.json.
    // Safe now because all clients are dead — no one can respawn daemon.
    const info = new GlobalInstanceManager({dataDir}).load()
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
          await Restart.waitForPidToDie(info.pid, KILL_VERIFY_TIMEOUT_MS)
        }
      }
    }

    // Phase 3: Kill orphaned server/agent processes not tracked in daemon.json.
    Restart.patternKill(Restart.SERVER_AGENT_PATTERNS)
    await Restart.sleep(KILL_SETTLE_MS)

    // Phase 4: Clean state files.
    this.cleanupAllDaemonFiles(dataDir)

    this.log('All ByteRover processes stopped.')

    // Force exit — oclif does not call process.exit() after run() returns,
    // relying on the event loop to drain. Third-party plugin hooks (e.g.
    // @oclif/plugin-update) can leave open handles that prevent exit.
    this.exitProcess(0)
  }
}
