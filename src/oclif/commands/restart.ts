import {
  DAEMON_INSTANCE_FILE,
  type EnsureDaemonResult,
  ensureDaemonRunning,
  getGlobalDataDir,
  GlobalInstanceManager,
  HEARTBEAT_FILE,
  SPAWN_LOCK_FILE,
} from '@campfirein/brv-transport-client'
import {Command} from '@oclif/core'
import {spawnSync} from 'node:child_process'
import {readdirSync, readFileSync, readlinkSync, unlinkSync} from 'node:fs'
import {dirname, join} from 'node:path'

import {resolveLocalServerMainPath} from '../../server/utils/server-main-resolver.js'

const MAX_ATTEMPTS = 3
const KILL_SETTLE_MS = 500
const DAEMON_START_TIMEOUT_MS = 15_000
const KILL_VERIFY_TIMEOUT_MS = 2000
const KILL_VERIFY_POLL_MS = 100

export default class Restart extends Command {
  static description = `Restart ByteRover — stop everything and start fresh.

Run this when ByteRover is unresponsive, stuck, or after installing an update.
All open sessions and background processes are stopped before the fresh start.`
  static examples = ['<%= config.bin %> <%= command.id %>']

  /**
   * Builds the list of file-path patterns used to identify brv processes for pattern kill.
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
   * Relative patterns (./bin/run.js, ./bin/dev.js) are intentionally excluded: they would
   * match any oclif CLI running in dev mode, not just brv.
   *
   * Set deduplicates when paths overlap (e.g. process.argv[1] is already run.js).
   */
  static buildKillPatterns(brvBinDir: string, argv1: string): string[] {
    // Patterns ordered from most specific to broadest:
    //   bin/brv                    — nvm/bundled binary (.../bin/brv)
    //   byterover-cli/bin/run.js   — npm global/nvm install (package name is always the folder name
    //                                in node_modules): /usr/local/.../byterover-cli/bin/run.js,
    //                                .nvm/.../byterover-cli/bin/run.js. NOT used for dev.js because
    //                                dev clones can have any directory name — covered by brvBinDir.
    //   exact sibling paths        — current installation's run.js / dev.js / run (any dir name)
    //   process.argv[1]            — current executable (bundled binary / dev entry)
    const brvScripts = [
      ...new Set([
        argv1,
        join('bin', 'brv'),
        join('byterover-cli', 'bin', 'run.js'),
        join(brvBinDir, 'dev.js'),
        join(brvBinDir, 'run'), // curl install: entry point named 'run' without .js suffix
        join(brvBinDir, 'run.js'),
      ]),
    ]
    return ['brv-server.js', 'agent-process.js', ...brvScripts]
  }

  /**
   * Build a pid→cwd map from `lsof -d cwd -Fn` output.
   *
   * On macOS, `-p <pid>` is ignored and lsof returns ALL processes.
   * Output format per process: `p<pid>\nfcwd\nn<cwd_path>`.
   * Returns empty map if lsof is unavailable.
   */
  private static buildCwdByPid(): Map<number, string> {
    const cwdByPid = new Map<number, string>()
    try {
      const lsofResult = spawnSync('lsof', ['-d', 'cwd', '-Fn'], {encoding: 'utf8'})
      if (!lsofResult.stdout) return cwdByPid
      const lines = lsofResult.stdout.split('\n')
      let curPid = -1
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('p')) {
          curPid = Number.parseInt(lines[i].slice(1), 10)
        } else if (lines[i] === 'fcwd' && curPid > 0 && lines[i + 1]?.startsWith('n')) {
          cwdByPid.set(curPid, lines[i + 1].slice(1))
        }
      }
    } catch {
      // lsof unavailable — caller falls back to relative-path patterns
    }

    return cwdByPid
  }

  /**
   * Kill matching brv processes on macOS by scanning all processes via `ps`.
   *
   * For processes started with a relative path (e.g. `./bin/dev.js`), the literal
   * relative path is in the OS cmdline — absolute-path patterns won't match.
   * Resolves relative .js paths using buildCwdByPid() to avoid false positives
   * (e.g. `byterover-cli-clone/bin/dev.js` must not match `byterover-cli/bin/dev.js`).
   *
   * When cwd is resolved: check only absolute patterns (precise, no false positives).
   * When cwd is unavailable: also check relative fallback patterns (./bin/dev.js).
   */
  private static killByMacOsProcScan(patterns: string[], excludePid: number): void {
    const psResult = spawnSync('ps', ['-A', '-o', 'pid,args'], {encoding: 'utf8'})
    if (!psResult.stdout) return

    const cwdByPid = Restart.buildCwdByPid()

    for (const line of psResult.stdout.split('\n').slice(1)) {
      const match = /^\s*(\d+)\s+(.+)$/.exec(line)
      if (!match) continue
      const pid = Number.parseInt(match[1], 10)
      const rawCmdline = match[2].trim()
      if (Number.isNaN(pid) || pid === excludePid) continue

      // Resolve relative .js path using cwd map to get an absolute path for matching.
      let cmdline = rawCmdline
      let cwdResolved = false
      const relativeJs = rawCmdline.split(/\s+/).find((a) => a.endsWith('.js') && !a.startsWith('/'))
      if (relativeJs) {
        const cwd = cwdByPid.get(pid)
        if (cwd) {
          cmdline = rawCmdline.replace(relativeJs, join(cwd, relativeJs))
          cwdResolved = true
        }
      }

      for (const pattern of patterns) {
        // When cwd resolved to absolute path, skip relative fallback patterns (those starting with
        // './') — the resolved cmdline no longer contains relative paths, so these won't match.
        // Prevents false positives against other projects (e.g. byterover-cli-clone) that also
        // run ./bin/dev.js when lsof is unavailable and cwd cannot be resolved.
        if (cwdResolved && pattern.startsWith('./')) continue
        if (cmdline.includes(pattern)) {
          try {
            process.kill(pid, 'SIGKILL')
          } catch {
            // Process already dead — ignore
          }

          break
        }
      }
    }
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
   *
   * For processes started with a relative path (e.g. `./bin/dev.js`), resolves
   * the path using /proc/<pid>/cwd so absolute-path patterns match correctly
   * without false positives.
   *
   * When cwd is resolved: check only absolute patterns (precise, no false positives).
   * When cwd is unavailable: also check relative fallback patterns (./bin/dev.js).
   * Mirrors the macOS killByMacOsProcScan behavior.
   *
   * Works on all Linux distros including Alpine — /proc is a kernel feature,
   * no userspace tools required.
   */
  private static killByProcScan(patterns: string[], excludePid: number): void {
    let entries: string[]
    try {
      entries = readdirSync('/proc')
    } catch {
      return // /proc not available — skip
    }

    for (const entry of entries) {
      const pid = Number.parseInt(entry, 10)
      if (Number.isNaN(pid) || pid === excludePid) continue
      try {
        const args = readFileSync(join('/proc', entry, 'cmdline'), 'utf8')
          .split('\0')
          .filter(Boolean)
        let cmdline = args.join(' ')

        // Resolve relative .js path using /proc/<pid>/cwd to match against absolute-path patterns.
        // Without this, `./bin/dev.js` would not match `byterover-cli/bin/dev.js`.
        let cwdResolved = false
        const relativeJs = args.find((a) => a.endsWith('.js') && !a.startsWith('/'))
        if (relativeJs) {
          try {
            const cwd = readlinkSync(join('/proc', entry, 'cwd'))
            cmdline = cmdline.replace(relativeJs, join(cwd, relativeJs))
            cwdResolved = true
          } catch {
            // cwd unreadable — use original cmdline
          }
        }

        for (const pattern of patterns) {
          // When cwd resolved to absolute path, skip relative fallback patterns (those starting with
          // './') — the resolved cmdline no longer contains relative paths, so these won't match.
          // Prevents false positives against other oclif CLIs that also run ./bin/dev.js.
          if (cwdResolved && pattern.startsWith('./')) continue
          if (cmdline.includes(pattern)) {
            process.kill(pid, 'SIGKILL')
            break // Already killing this PID — no need to check remaining patterns
          }
        }
      } catch {
        // Process exited or permission denied — ignore
      }
    }
  }

  /**
   * Best-effort pattern kill for all brv processes (daemon, agents, TUI sessions, MCP servers,
   * headless commands). Errors are silently ignored.
   *
   * Relative paths (e.g. `./bin/dev.js`) are resolved via cwd before pattern matching,
   * ensuring accuracy without false positives from other oclif CLIs.
   *
   * OS dispatch:
   *   Linux (incl. Alpine, WSL2): /proc scan + /proc/<pid>/cwd resolution
   *   macOS:                      ps -A scan + lsof cwd resolution
   *   Windows:                    PowerShell Get-CimInstance — available Windows 8+ / PS 3.0+
   *
   * Self-exclusion: own PID filtered on Unix; excluded explicitly in PowerShell query.
   */
  private static patternKill(): void {
    const brvBinDir = dirname(process.argv[1])
    const allPatterns = Restart.buildKillPatterns(brvBinDir, process.argv[1])

    if (process.platform === 'win32') {
      const whereClause = allPatterns.map((p) => `$_.CommandLine -like '*${p}*'`).join(' -or ')
      const script = `Get-CimInstance Win32_Process | Where-Object { (${whereClause}) -and $_.ProcessId -ne ${process.pid} } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`
      spawnSync('powershell', ['-Command', script], {stdio: 'ignore'})
    } else if (process.platform === 'linux') {
      Restart.killByProcScan(allPatterns, process.pid)
    } else {
      // macOS (and other Unix): ps -A scan with lsof cwd resolution for relative paths
      Restart.killByMacOsProcScan(allPatterns, process.pid)
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
   * On ESRCH the PID is confirmed dead. Silently times out if the process
   * outlives timeoutMs (e.g. zombie held by parent).
   * Unix only — on Windows, taskkill /f is synchronous so no polling needed.
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
    // Timed out — continue anyway; retry loop will kill again if still alive
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

  protected async killAllBrvProcesses(dataDir: string): Promise<void> {
    this.log('Stopping processes...')

    // Read PID directly from daemon.json — no health-check filtering.
    const info = new GlobalInstanceManager({dataDir}).load()
    if (info !== undefined) {
      Restart.killByPid(info.pid)
      // Verify the daemon PID is dead before pattern-killing the rest.
      // taskkill /f on Windows is synchronous so polling is only needed on Unix.
      if (process.platform !== 'win32') {
        await Restart.waitForPidToDie(info.pid, KILL_VERIFY_TIMEOUT_MS)
      }
    }

    // Always run pattern kill — catches processes not in daemon.json
    // (agents, TUI sessions, MCP servers, headless commands).
    Restart.patternKill()

    await Restart.sleep(KILL_SETTLE_MS)
  }

  async run(): Promise<void> {
    const serverPath = resolveLocalServerMainPath()
    const dataDir = getGlobalDataDir()

    /* eslint-disable no-await-in-loop -- intentional sequential retry loop */
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (attempt > 1) {
        this.log(`Attempt ${attempt}/${MAX_ATTEMPTS}...`)
      }

      await this.killAllBrvProcesses(dataDir)
      this.cleanupAllDaemonFiles(dataDir)

      this.log('Starting daemon...')
      const result = await this.startDaemon(serverPath)

      if (result.success) {
        this.log(`Daemon started (PID ${result.info.pid}, port ${result.info.port})`)
        return
      }

      const detail = result.spawnError ? ` (${result.spawnError})` : ''
      if (attempt < MAX_ATTEMPTS) {
        this.log(`Daemon did not start (${result.reason}${detail}). Retrying...`)
      } else {
        this.error(`Failed to start daemon after ${MAX_ATTEMPTS} attempts: ${result.reason}${detail}`)
      }
    }
    /* eslint-enable no-await-in-loop */
  }

  protected async startDaemon(serverPath: string): Promise<EnsureDaemonResult> {
    return ensureDaemonRunning({serverPath, timeoutMs: DAEMON_START_TIMEOUT_MS})
  }
}
