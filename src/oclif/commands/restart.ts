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
import {dirname, join, resolve} from 'node:path'

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
  /** Commands whose processes must not be killed (e.g. `brv update` calls `brv restart`). */
  private static readonly PROTECTED_COMMANDS = ['update']
  /** Server/agent patterns — cannot match CLI processes, no self-kill risk. */
  private static readonly SERVER_AGENT_PATTERNS = ['brv-server.js', 'agent-process.js']

  /**
   * Returns the process + ancestor chain up to (but not including) pid 1.
   *
   * Needed to protect every bash-wrapper layer when the oclif + plugin-update chain
   * is: outer bash (tarball) → redirect shim → inner bash (client) → node. Each layer
   * has `bin/brv` in its cmdline and would self-kill if not excluded. `process.ppid`
   * alone only covers the direct parent — grandparents and beyond need this walker.
   *
   * `getPpidOf` is injected for testability; the default queries the OS.
   */
  static ancestorPids(
    startPid: number,
    getPpidOf: (pid: number) => number | undefined = Restart.createDefaultGetPpidOf(),
  ): number[] {
    const chain: number[] = []
    const visited = new Set<number>()
    let pid = startPid
    while (pid > 1 && !visited.has(pid)) {
      chain.push(pid)
      visited.add(pid)
      const ppid = getPpidOf(pid)
      if (ppid === undefined || ppid === pid || ppid <= 1) break
      pid = ppid
    }

    return chain
  }

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
   * Builds the Windows PowerShell kill script for `patternKill`.
   *
   * Extracted for testability — the actual spawn is a side-effect on win32. Non-finite
   * pids (NaN/Infinity) are dropped so a stray undefined in the exclude set cannot
   * collapse to `$_.ProcessId -ne NaN` (PowerShell-true for every row, silent skip).
   * `$true` fallback keeps the emitted script syntactically valid when the exclude set
   * is empty or fully non-finite — prevents a trailing `-and` from breaking PS parsing.
   */
  static buildWindowsKillScript(patterns: string[], excludePids: Iterable<number>, skipProtected: boolean): string {
    const whereClause = patterns.map((p) => `$_.CommandLine -like '*${p.replaceAll("'", "''")}*'`).join(' -or ')
    const excludeClause =
      [...excludePids]
        .filter((p) => Number.isFinite(p))
        .map((p) => `$_.ProcessId -ne ${p}`)
        .join(' -and ') || '$true'
    const protectedClause = skipProtected
      ? ` -and ${Restart.PROTECTED_COMMANDS.map((cmd) => `$_.CommandLine -notlike '* ${cmd} *' -and $_.CommandLine -notlike '* ${cmd}'`).join(' -and ')}`
      : ''
    return `Get-CimInstance Win32_Process | Where-Object { (${whereClause}) -and ${excludeClause}${protectedClause} } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`
  }

  /**
   * Parses a Linux `/proc/<pid>/stat` line into the ppid, or undefined if malformed.
   *
   * The stat format is `<pid> (<comm>) <state> <ppid> <pgrp> ...`. The comm field can
   * contain spaces and parens, so we anchor on the last `)` — everything after
   * `") "` is space-delimited and `ppid` is the second token.
   *
   * Extracted as a pure function for testability — the surrounding `getPpidOf` does
   * a filesystem read that's awkward to mock.
   */
  static parseProcStat(stat: string): number | undefined {
    const lastParen = stat.lastIndexOf(')')
    if (lastParen === -1) return undefined
    const rest = stat.slice(lastParen + 2).split(' ')
    if (rest.length < 2) return undefined
    const n = Number.parseInt(rest[1], 10)
    return Number.isNaN(n) ? undefined : n
  }

  /**
   * Parses `"<pid>,<ppid>\n..."` stdout from the PowerShell process-table query into
   * a Map. Tolerates header rows, blank lines, CRLF endings, and malformed rows (any
   * row whose pid or ppid is non-numeric is dropped silently).
   */
  static parseWindowsProcessTable(stdout: string): Map<number, number> {
    const table = new Map<number, number>()
    for (const line of stdout.split(/\r?\n/)) {
      const [pidStr, ppidStr] = line.split(',')
      const pid = Number.parseInt(pidStr, 10)
      const ppid = Number.parseInt(ppidStr, 10)
      if (Number.isFinite(pid) && Number.isFinite(ppid)) {
        table.set(pid, ppid)
      }
    }

    return table
  }

  /**
   * Builds the default `getPpidOf` for the current platform.
   *
   * On Windows, preloads the full Win32_Process table with a single PowerShell
   * invocation (~200 ms cold start) and returns a Map-backed closure — replaces the
   * prior per-pid PowerShell spawn, which was O(ancestors × PS startup) per
   * `ancestorPids` call. On Linux/macOS/other Unix, falls through to per-pid
   * `getPpidOf` (cheap — `/proc` read or `ps -o ppid=`).
   */
  private static createDefaultGetPpidOf(): (pid: number) => number | undefined {
    if (process.platform === 'win32') {
      const table = Restart.loadWindowsProcessTable()
      return (pid) => table.get(pid)
    }

    return (pid) => Restart.getPpidOf(pid)
  }

  /**
   * Returns the parent PID of a given PID, or undefined if the process is gone.
   *
   * Windows is handled via the batched `loadWindowsProcessTable` path in
   * `createDefaultGetPpidOf` — this function only covers Unix-family platforms:
   *   linux         : /proc/<pid>/stat, parsed via `parseProcStat`
   *   darwin (macOS): ps -p <pid> -o ppid=
   *   other Unix    : same ps command as darwin
   */
  private static getPpidOf(pid: number): number | undefined {
    if (process.platform === 'linux') {
      try {
        return Restart.parseProcStat(readFileSync(join('/proc', String(pid), 'stat'), 'utf8'))
      } catch {
        return undefined
      }
    }

    // darwin (macOS) + other Unix (FreeBSD, etc.) — POSIX ps.
    const result = spawnSync('ps', ['-p', String(pid), '-o', 'ppid='], {encoding: 'utf8'})
    if (result.status !== 0) return undefined
    const n = Number.parseInt(result.stdout.trim(), 10)
    return Number.isNaN(n) ? undefined : n
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
        spawnSync('taskkill', ['/pid', String(pid), '/f', '/t'], {stdio: 'ignore', windowsHide: true})
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
   * Loads the full Windows process table (pid → ppid) via one PowerShell invocation.
   * Returns an empty map if PowerShell fails or is unavailable.
   */
  private static loadWindowsProcessTable(): Map<number, number> {
    const result = spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId),$($_.ParentProcessId)" }',
      ],
      {encoding: 'utf8', windowsHide: true},
    )
    if (result.status !== 0) return new Map()
    return Restart.parseWindowsProcessTable(result.stdout)
  }

  /**
   * Pattern-kill brv processes matching the given patterns.
   *
   * Self-exclusion covers the full ancestor chain (self → parent → grandparent → …).
   * Required because a `brv restart` under the oclif bash wrapper + plugin-update
   * redirect chain has up to four ancestors (outer tarball wrapper → redirect shim →
   * inner client wrapper → node), every one of which contains `bin/brv` in its
   * cmdline. Excluding only `process.ppid` leaves grandparents open to self-kill.
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
    // Self-exclusion: walk the full ancestor chain (getPpidOf is platform-aware —
    // Linux /proc, macOS ps, Windows PowerShell CIM). process.pid + process.ppid
    // are kept as explicit fallbacks in case the walker regresses or returns empty
    // on an unexpected platform — Set dedups so there's no cost.
    const excludePids = new Set<number>([
      process.pid,
      process.ppid,
      ...Restart.ancestorPids(process.pid),
    ])

    if (process.platform === 'win32') {
      const script = Restart.buildWindowsKillScript(patterns, excludePids, skipProtected)
      spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {stdio: 'ignore', windowsHide: true})
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

    // Force exit — oclif does not call process.exit() after run() returns,
    // relying on the event loop to drain. Third-party plugin hooks (e.g.
    // @oclif/plugin-update) can leave open handles that prevent exit.
    this.exitProcess(0)
  }
}
