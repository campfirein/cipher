// Slice 8.2 — pure install logic for the brv-channel skill.
// Separated from bin/install.js so unit tests can import the functions
// without spawning a subprocess.

import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {dirname, join} from 'node:path'

/**
 * Canonical per-host skill discovery paths, relative to $HOME.
 *
 * Slice 8.2 ships THREE default targets, which between them cover the
 * five hosts audited in plan/channel-protocol/IMPLEMENTATION_PHASE_8.md:
 *
 *  - `~/.claude/skills/brv-channel/SKILL.md` — Claude Code (native);
 *    kimi-cli and opencode read it via their cross-brand fallback chains.
 *  - `~/.codex/skills/brv-channel/SKILL.md` — Codex CLI (codex does NOT
 *    fall back to ~/.claude, so it needs its own path).
 *  - `~/.agents/skills/brv-channel/SKILL.md` — Pi (cross-brand fallback);
 *    kimi-cli also reads this as an additional fallback.
 */
export const HOST_TO_PATH = Object.freeze({
  claude: '.claude/skills/brv-channel/SKILL.md',
  codex: '.codex/skills/brv-channel/SKILL.md',
  pi: '.agents/skills/brv-channel/SKILL.md',
})

/**
 * Aliases that map onto one of the three canonical paths above.
 * kimi-cli reads ~/.claude/skills first; opencode reads ~/.claude/skills.
 * Users passing `--target kimi` or `--target opencode` get the
 * Claude-Code path so the skill is discoverable for them too.
 */
const TARGET_ALIASES = Object.freeze({
  kimi: 'claude',
  opencode: 'claude',
})

export const DEFAULT_TARGET_PATHS = Object.freeze(['claude', 'codex', 'pi'])

/**
 * Resolve a `--target <host>` plus optional `--path <abs>` override
 * into a concrete list of absolute paths to write to.
 *
 * @param {object} opts
 * @param {string} opts.homeDir   `$HOME` (or test override).
 * @param {string} [opts.target]  Host name; 'all' = the three default paths.
 * @param {string} [opts.customPath]  Absolute path that overrides --target.
 * @returns {string[]} absolute paths in deterministic order
 */
export const resolveTargets = ({customPath, homeDir, target}) => {
  if (typeof customPath === 'string' && customPath !== '') {
    return [customPath]
  }

  const which = target ?? 'all'
  if (which === 'all') {
    return DEFAULT_TARGET_PATHS.map((host) => join(homeDir, HOST_TO_PATH[host]))
  }

  const resolved = TARGET_ALIASES[which] ?? which
  if (HOST_TO_PATH[resolved] === undefined) {
    throw new Error(
      `unknown target: ${which}. Expected one of: claude, codex, kimi, opencode, pi, all (or use --path <abs>).`,
    )
  }

  return [join(homeDir, HOST_TO_PATH[resolved])]
}

/**
 * Install the skill body to each of `targets`. Idempotent: if a target
 * already contains identical content, it's reported in `.skipped`. If
 * a target exists with different content, throws unless `force: true`.
 *
 * @param {object} opts
 * @param {string} opts.skillSource  Absolute path to the source SKILL.md.
 * @param {string[]} opts.targets    Absolute destination paths.
 * @param {boolean} [opts.dryRun]    If true, no disk writes.
 * @param {boolean} [opts.force]     If true, overwrite differing content.
 * @returns {Promise<{written: string[], skipped: string[]}>}
 */
export const install = async ({dryRun, force, skillSource, targets}) => {
  if (!existsSync(skillSource)) {
    throw new Error(`SKILL.md source not found at ${skillSource}`)
  }

  const body = readFileSync(skillSource, 'utf8')
  const written = []
  const skipped = []

  for (const target of targets) {
    if (existsSync(target)) {
      const current = readFileSync(target, 'utf8')
      if (current === body) {
        skipped.push(target)
        continue
      }

      if (force !== true) {
        throw new Error(
          `${target} already exists with different content. Pass --force to overwrite.`,
        )
      }
    }

    if (dryRun !== true) {
      mkdirSync(dirname(target), {recursive: true})
      writeFileSync(target, body, 'utf8')
    }

    written.push(target)
  }

  return {skipped, written}
}
