#!/bin/sh
# byterover-legacy-plugin.sh — Legacy ByteRover Context Plugin Installer
#
# DEPRECATED: This script installs the old local-file-based ByteRover context plugin.
# For new installations, use the official plugin CLI instead:
#   openclaw plugins install @byterover/byterover
#
# This script is provided for users who need the previous manual plugin installation
# (e.g. air-gapped environments, custom plugin modifications, or rollback scenarios).
#
# Usage: sh scripts/byterover-legacy-plugin.sh [--uninstall]

set -eu

# ─── Constants ────────────────────────────────────────────────────────────────

CONFIG_PATH="$HOME/.openclaw/openclaw.json"
PLUGIN_DIR="$HOME/.openclaw/extensions/byterover"

# ─── Colors (respects NO_COLOR and non-terminal) ─────────────────────────────

if [ -n "${NO_COLOR:-}" ] || [ ! -t 1 ]; then
  GREEN=''
  YELLOW=''
  RED=''
  BLUE=''
  RESET=''
else
  GREEN='\033[32m'
  YELLOW='\033[1;33m'
  RED='\033[31m'
  BLUE='\033[34m'
  RESET='\033[0m'
fi

# ─── Helpers ──────────────────────────────────────────────────────────────────

info() {
  printf "${BLUE}%s${RESET}\n" "$1"
}

success() {
  printf "${GREEN}[ok] %s${RESET}\n" "$1"
}

warn() {
  printf "${YELLOW}[!] %s${RESET}\n" "$1" >&2
}

error() {
  printf "${RED}[X] %s${RESET}\n" "$1" >&2
  exit 1
}

confirm() {
  printf "%s (y/N): " "$1"
  if [ -t 0 ]; then
    read -r answer
  else
    read -r answer < /dev/tty
  fi
  case "${answer:-}" in
    [Yy]|[Yy][Ee][Ss]) return 0 ;;
    *) return 1 ;;
  esac
}

# ─── Plugin Config Management ────────────────────────────────────────────────

enable_plugin_in_config() {
  CONFIG_PATH="$CONFIG_PATH" node -e '
    const fs = require("fs");
    const configPath = process.env.CONFIG_PATH;
    try {
        const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
        config.plugins = config.plugins || {};
        config.plugins.entries = config.plugins.entries || {};
        config.plugins.entries["byterover"] = { enabled: true };
        // Pin as trusted to suppress "untracked local code" warning
        config.plugins.allow = config.plugins.allow || [];
        if (!config.plugins.allow.includes("byterover")) {
            config.plugins.allow.push("byterover");
        }
        // Register extension load path
        config.plugins.load = config.plugins.load || {};
        config.plugins.load.paths = config.plugins.load.paths || [];
        const brvPath = "~/.openclaw/extensions/byterover";
        if (!config.plugins.load.paths.includes(brvPath)) {
            config.plugins.load.paths.push(brvPath);
        }
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        console.log("Plugin enabled in config.");
    } catch (e) {
        console.error("Failed to update config for plugin:", e);
        process.exit(1);
    }
  '
}

disable_plugin_in_config() {
  CONFIG_PATH="$CONFIG_PATH" node -e '
    const fs = require("fs");
    const configPath = process.env.CONFIG_PATH;
    try {
        const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
        const entries = config.plugins?.entries;
        if (!entries || !entries["byterover"]) {
            console.log("No plugin config found.");
            process.exit(0);
        }
        delete entries["byterover"];
        // Also remove from trust list
        if (Array.isArray(config.plugins?.allow)) {
            config.plugins.allow = config.plugins.allow.filter(id => id !== "byterover");
            if (config.plugins.allow.length === 0) delete config.plugins.allow;
        }
        // Also remove from load paths
        if (Array.isArray(config.plugins?.load?.paths)) {
            config.plugins.load.paths = config.plugins.load.paths.filter(p => p !== "~/.openclaw/extensions/byterover");
            if (config.plugins.load.paths.length === 0) delete config.plugins.load.paths;
            if (config.plugins.load && Object.keys(config.plugins.load).length === 0) delete config.plugins.load;
        }
        if (Object.keys(entries).length === 0) delete config.plugins.entries;
        if (config.plugins && Object.keys(config.plugins).length === 0) delete config.plugins;
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        console.log("Plugin disabled in config.");
    } catch (e) {
        console.error("Failed to remove plugin config:", e);
        process.exit(1);
    }
  '
}

remove_plugin_files() {
  if [ -d "$PLUGIN_DIR" ]; then
    rm -rf "$PLUGIN_DIR"
    success "Removed plugin files from $PLUGIN_DIR"
  else
    echo "No plugin files found."
  fi
}

# ─── Plugin File Creation ────────────────────────────────────────────────────

create_plugin_files() {
  mkdir -p "$PLUGIN_DIR"

  # Fix ownership if directory was created by a different user (e.g. root)
  if [ -d "$PLUGIN_DIR" ] && [ ! -w "$PLUGIN_DIR" ]; then
    warn "Plugin directory not writable: $PLUGIN_DIR"
    warn "This usually happens when the setup was previously run as a different user (e.g. root)."
    error "Fix with: sudo chown -R \$(whoami) $HOME/.openclaw/extensions"
  fi

  echo "Creating plugin files in $PLUGIN_DIR..."

  # Create index.ts
  cat > "$PLUGIN_DIR/index.ts" <<'EOF'
import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync } from "fs";
import { join, delimiter } from "path";
import { homedir, platform } from "os";

const execFileAsync = promisify(execFile);

// ── brv binary resolution ──────────────────────────────────────────────────
// Non-interactive processes (Docker gateway, systemd, cron, launchd) don't
// source shell configs, so ~/.brv-cli/bin may not be in PATH. This function
// probes well-known install locations and caches the result.

let _cachedBrvPath: string | null = null;

function resolveBrvPath(): string {
  if (_cachedBrvPath !== null) return _cachedBrvPath;

  const home = homedir();
  const isWindows = platform() === "win32";
  const brvName = isWindows ? "brv.cmd" : "brv";

  const candidates: string[] = [
    join(home, ".brv-cli", "bin", brvName),
    ...(isWindows
      ? [process.env.APPDATA ? join(process.env.APPDATA, "npm", brvName) : ""]
      : [
          join("/usr", "local", "bin", brvName),
          join("/usr", "bin", brvName),
          join(home, ".npm-global", "bin", brvName),
        ]
    ),
  ].filter(Boolean);

  for (const p of candidates) {
    if (existsSync(p)) {
      _cachedBrvPath = p;
      return p;
    }
  }

  _cachedBrvPath = brvName;
  return brvName;
}

function buildBrvEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const brvBinDir = join(homedir(), ".brv-cli", "bin");
  env.PATH = brvBinDir + delimiter + (env.PATH || "");
  return env;
}

function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}

// ── Workspace CWD resolution ────────────────────────────────────────────────
// The OpenClaw gateway runs with cwd=/, so we must derive the correct workspace
// directory from the sessionKey. Convention: "main" agent → base path, others →
// base-<agentId>. Same logic as brv-openclaw-plugin/src/message-utils.ts.

function resolveWorkspaceDir(sessionKey?: string, baseCwd?: string): string {
  const base = baseCwd || join(homedir(), ".openclaw", "workspace");
  if (!sessionKey) return base;
  const parts = sessionKey.split(":");
  const agentId = parts.length >= 2 && parts[0] === "agent" ? parts[1] : undefined;
  if (!agentId || agentId === "main") return base;
  return `${base}-${agentId}`;
}

export default function (api) {
  api.logger.info("[byterover] Loaded!");

  api.on("before_prompt_build", async (event, ctx) => {
    // ── Query ByteRover for relevant context ──
    let userPrompt = event.prompt;

    if (!userPrompt) {
      const messages = ctx?.messages || [];
      const lastUserMessage = messages.slice().reverse().find(m => m.role === 'user');
      userPrompt = lastUserMessage?.content || "";
    }

    // Strip OpenClaw metadata headers if present to get the real user query
    userPrompt = userPrompt.replace(/^Conversation info \(untrusted metadata\):[\s\S]*?```json[\s\S]*?```\s*/i, "").trim();

    // If still empty, nothing to query
    if (!userPrompt) return;

    const queryText = userPrompt;

    const brvPath = resolveBrvPath();

    const curateReminder = `\n\n## ByteRover Usage\n` +
      `- **Before answering:** context above was retrieved automatically.\n` +
      `- **After completing this task:** if you learned something valuable, run \`${brvPath} curate "<key insight>"\` to save it.\n`;

    const workspaceDir = resolveWorkspaceDir(ctx?.sessionKey);
    try {
      api.logger.debug(`[byterover] Querying brv (${brvPath}) for: "${queryText}" (cwd=${workspaceDir})`);

      const { stdout } = await execFileAsync(brvPath, ["query", queryText], {
        timeout: 300000,
        env: buildBrvEnv(),
        cwd: workspaceDir,
      });

      const brvOutput = stdout.trim();

      if (brvOutput) {
        const header = "\n\n## ByteRover Context (Auto-Enriched)\n";
        const injection = `${header}${brvOutput}${curateReminder}`;

        api.logger.info(`[byterover] Injected ${brvOutput.length} chars of context.`);

        return { prependContext: injection };
      }

      // No existing context — skip injection to avoid reminder noise on empty context trees
      return;
    } catch (err: unknown) {
      const errCode = isErrnoException(err) ? err.code : undefined;
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errCode !== 'ENOENT') {
        api.logger.warn(`[byterover] Query failed (${brvPath}): ${errMsg}`);
      } else {
        api.logger.debug(`[byterover] brv not found at '${brvPath}'. Is ByteRover CLI installed?`);
      }
    }
  });

  // ── Strip raw thinking/reasoning blocks from LLM responses ──────────────
  // Some models (DeepSeek, Claude with extended thinking, Qwen) emit
  // <thinking>…</thinking> or <think>…</think> blocks. These are internal
  // chain-of-thought and must never be shown to the end user.
  api.on("message_sending", async (event) => {
    if (!event.content || typeof event.content !== "string") return;

    const original = event.content;

    // Only strip if response starts with a thinking/reasoning block (chain-of-thought preamble).
    // Avoids silently removing legitimate content when users discuss XML or prompt engineering.
    let filtered = original;
    const thinkingPattern = /^<(?:thinking|think|reasoning|reflection)>/i;
    if (thinkingPattern.test(filtered)) {
      let prev;
      do {
        prev = filtered;
        filtered = filtered
          .replace(/^<think>[\s\S]*?<\/think>/i, "")
          .replace(/^<thinking>[\s\S]*?<\/thinking>/i, "")
          .replace(/^<reasoning>[\s\S]*?<\/reasoning>/i, "")
          .replace(/^<reflection>[\s\S]*?<\/reflection>/i, "");
        filtered = filtered.trimStart();
      } while (filtered !== prev && thinkingPattern.test(filtered));
    }

    // Clean up leftover blank lines from removal
    filtered = filtered.replace(/\n{3,}/g, "\n\n").trim();

    if (filtered !== original) {
      const strippedChars = original.length - filtered.length;
      api.logger.debug(`[byterover] Stripped ${strippedChars} chars of thinking/reasoning blocks from response`);
    }

    // If stripping left nothing meaningful, don't send an empty message
    if (!filtered) return { cancel: true };

    return filtered !== original ? { content: filtered } : undefined;
  });
}
EOF

  # Create openclaw.plugin.json
  cat > "$PLUGIN_DIR/openclaw.plugin.json" <<'EOF'
{
  "id": "byterover",
  "name": "ByteRover Context",
  "version": "1.0.0",
  "entry": "./index.ts",
  "description": "Injects ByteRover context into the system prompt based on user queries.",
  "configSchema": {
    "type": "object",
    "additionalProperties": true
  }
}
EOF

  success "Plugin files created."
}

# ─── Main ─────────────────────────────────────────────────────────────────────

main() {
  warn "DEPRECATED: This script installs the legacy local-file-based plugin."
  warn "For new installations, use: openclaw plugins install @byterover/byterover"
  echo ""

  case "${1:-}" in
    --uninstall)
      info "Uninstalling legacy ByteRover context plugin..."
      disable_plugin_in_config
      remove_plugin_files
      success "Legacy plugin uninstalled."
      exit 0
      ;;
  esac

  if [ ! -f "$CONFIG_PATH" ]; then
    error "OpenClaw config not found at $CONFIG_PATH. Is OpenClaw installed?"
  fi

  printf "${YELLOW}Feature: ByteRover Context Plugin (Legacy)${RESET}\n"
  echo "Installs a local OpenClaw plugin (byterover) to inject memory context into prompts."
  echo ""

  if ! confirm "Install legacy ByteRover Context Plugin?"; then
    echo "Skipped."
    exit 0
  fi

  # Remove any existing byterover plugins (new CLI-based and old local) before installing
  info "Removing existing ByteRover plugins..."
  openclaw plugins uninstall byterover --force 2>/dev/null || true
  openclaw config unset plugins.slots.contextEngine 2>/dev/null || true
  disable_plugin_in_config
  remove_plugin_files

  create_plugin_files
  enable_plugin_in_config
  success "Legacy ByteRover Context Plugin installed and enabled."
}

main "$@"
