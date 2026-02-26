#!/bin/sh
# openclaw-setup.sh — ByteRover Integration Installer for OpenClaw
# Usage: curl -fsSL https://storage.googleapis.com/brv-releases/openclaw-setup.sh | sh
#
# Configures ByteRover as long-term memory for OpenClaw agents:
#   - Automatic Memory Flush (context compaction)
#   - Daily Knowledge Mining (cron job)
#   - ByteRover Context Plugin (hook-based injection)
#   - Workspace protocol updates (AGENTS.md, TOOLS.md)

set -eu

# ─── Constants ────────────────────────────────────────────────────────────────

CONFIG_PATH="$HOME/.openclaw/openclaw.json"
BRV_STORAGE="$HOME/.openclaw"
PLUGIN_DIR="$HOME/.openclaw/extensions/byterover"

# ─── Colors (respects NO_COLOR and non-terminal) ─────────────────────────────

if [ -n "${NO_COLOR:-}" ] || [ ! -t 1 ]; then
  BOLD=''
  DIM=''
  GREEN=''
  YELLOW=''
  RED=''
  BLUE=''
  RESET=''
else
  BOLD='\033[1m'
  DIM='\033[2m'
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
  prompt="$1"
  if [ -t 0 ]; then
    read -p "$prompt (y/N): " answer
  else
    read -p "$prompt (y/N): " answer < /dev/tty
  fi
  [[ "${answer:-}" =~ ^[Yy]$ ]]
}

setup_cleanup() {
  CLEANUP_FILES=()
  cleanup() { rm -f "${CLEANUP_FILES[@]}"; }
  trap cleanup EXIT
}

# ─── Pre-flight Checks ───────────────────────────────────────────────────────

check_node() {
  if command -v node &> /dev/null; then
    success "Node is installed"
  else
    error "Node is missing. Node.js is required to run this installer."
  fi
}

check_clawhub() {
  if command -v clawhub &> /dev/null; then
    success "Clawhub is installed"
  else
    error "Clawhub is missing. Please install it first via OpenClaw's skill."
  fi
}

check_brv_skill() {
  if clawhub list | grep -qw "byterover"; then
    success "ByteRover Skill is installed"
  else
    warn "ByteRover Skill is missing. Installing byterover..."
    if clawhub install --force byterover; then
      success "ByteRover skill installed successfully"
    else
      error "Failed to install byterover."
    fi
  fi
}

check_brv_cli() {
  if command -v brv &> /dev/null; then
    success "ByteRover-cli is installed"
  else
    error "ByteRover-cli is missing. Please install it first (https://docs.byterover.dev)."
  fi
}

check_openclaw_cli() {
  if command -v openclaw &> /dev/null; then
    success "OpenClaw CLI is installed"
  else
    error "OpenClaw CLI is missing. Cannot schedule OpenClaw cron jobs."
  fi
}

check_config() {
  if [ ! -f "$CONFIG_PATH" ]; then
    error "Config file not found at $CONFIG_PATH. Please install openclaw first (https://docs.openclaw.ai/install#npm-pnpm) to generate the configuration."
  fi

  if ! CONFIG_PATH="$CONFIG_PATH" node -e 'JSON.parse(require("fs").readFileSync(process.env.CONFIG_PATH, "utf8"))' 2>/dev/null; then
    error "Config file at $CONFIG_PATH is not valid JSON."
  fi

  success "Config file is valid"
}

# ─── Storage Setup ────────────────────────────────────────────────────────────

setup_storage_dir() {
  info "Phase 1.1: ByteRover Storage Location"

  printf "ByteRover Context Tree will be stored in: ${GREEN}%s/.brv${RESET}\n" "$BRV_STORAGE"
  echo "This allows all OpenClaw agents to share the same knowledge base."

  if [ ! -d "$BRV_STORAGE" ]; then
    warn "Directory does not exist. Creating..."
    mkdir -p "$BRV_STORAGE"
  fi
}

backup_config() {
  CONFIG_BACKUP="${CONFIG_PATH}.bak.$(date +%Y%m%d%H%M%S)"
  cp "$CONFIG_PATH" "$CONFIG_BACKUP"
  echo "Backed up config to $CONFIG_BACKUP"
}

# ─── Config Patching (Node.js) ───────────────────────────────────────────────

patch_memory_flush_config() {
  FLUSH_SYSTEM_PROMPT="$1" FLUSH_PROMPT="$2" CONFIG_PATH="$CONFIG_PATH" node -e '
    const fs = require("fs");
    const configPath = process.env.CONFIG_PATH;
    const systemPrompt = process.env.FLUSH_SYSTEM_PROMPT;
    const prompt = process.env.FLUSH_PROMPT;
    try {
        const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

        config.agents = config.agents || {};
        config.agents.defaults = config.agents.defaults || {};
        config.agents.defaults.compaction = config.agents.defaults.compaction || {};

        config.agents.defaults.compaction.reserveTokensFloor = 50000;
        config.agents.defaults.compaction.memoryFlush = {
            enabled: true,
            softThresholdTokens: 4000,
            systemPrompt: systemPrompt,
            prompt: prompt
        };

        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        console.log("Config updated successfully.");
    } catch (e) {
        console.error("Failed to patch config:", e);
        process.exit(1);
    }
  '
}

check_cron_exists() {
  local cron_list_file="$1"
  local cron_name="$2"

  CRON_LIST_TMP="$cron_list_file" CRON_NAME="$cron_name" node -e '
    try {
        const fs = require("fs");
        const content = fs.readFileSync(process.env.CRON_LIST_TMP, "utf8").trim();
        if (!content) { console.log("false"); process.exit(0); }
        const json = JSON.parse(content);
        const jobs = json.jobs || [];
        const exists = jobs.some(j => j.name === process.env.CRON_NAME);
        console.log(exists ? "true" : "false");
    } catch(e) { console.log("false"); }
  '
}

find_cron_job_id() {
  local cron_list_file="$1"
  local cron_name="$2"

  CRON_LIST_TMP="$cron_list_file" CRON_NAME="$cron_name" node -e '
    try {
        const fs = require("fs");
        const content = fs.readFileSync(process.env.CRON_LIST_TMP, "utf8").trim();
        if (!content) process.exit(0);
        const json = JSON.parse(content);
        const jobs = json.jobs || [];
        const job = jobs.find(j => j.name === process.env.CRON_NAME);
        if (job && (job.jobId || job.id)) console.log(job.jobId || job.id);
    } catch(e) { /* silent */ }
  '
}

enable_plugin_in_config() {
  CONFIG_PATH="$CONFIG_PATH" node -e '
    const fs = require("fs");
    const configPath = process.env.CONFIG_PATH;
    try {
        const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
        config.plugins = config.plugins || {};
        config.plugins.entries = config.plugins.entries || {};
        config.plugins.entries["byterover"] = { enabled: true };
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        console.log("Plugin enabled in config.");
    } catch (e) {
        console.error("Failed to update config for plugin:", e);
        process.exit(1);
    }
  '
}

remove_memory_flush_config() {
  CONFIG_PATH="$CONFIG_PATH" node -e '
    const fs = require("fs");
    const configPath = process.env.CONFIG_PATH;
    try {
        const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
        const compaction = config.agents?.defaults?.compaction;
        if (!compaction) { console.log("No memory flush config found."); process.exit(0); }
        let changed = false;
        if (compaction.memoryFlush) { delete compaction.memoryFlush; changed = true; }
        if (compaction.reserveTokensFloor) { delete compaction.reserveTokensFloor; changed = true; }
        if (Object.keys(compaction).length === 0) delete config.agents.defaults.compaction;
        if (changed) {
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
            console.log("Memory flush config removed.");
        } else {
            console.log("No memory flush config found.");
        }
    } catch (e) {
        console.error("Failed to remove memory flush config:", e);
        process.exit(1);
    }
  '
}

remove_cron_job() {
  local cron_name="$1"

  local cron_list_tmp
  cron_list_tmp=$(mktemp)
  CLEANUP_FILES+=("$cron_list_tmp")

  local cron_rc=0
  openclaw cron list --json > "$cron_list_tmp" 2>/dev/null || cron_rc=$?

  if [ $cron_rc -ne 0 ] && [ ! -s "$cron_list_tmp" ]; then
    warn "Failed to list cron jobs. Cannot check for existing job."
    return
  fi

  local job_id=""
  if [ -s "$cron_list_tmp" ]; then
    job_id=$(find_cron_job_id "$cron_list_tmp" "$cron_name")
  fi

  if [ -z "$job_id" ]; then
    echo "No existing cron job '$cron_name' found."
    return
  fi

  echo "Removing cron job '$cron_name' (id: $job_id)..."
  if openclaw cron remove "$job_id" < /dev/null 2>/dev/null; then
    success "Cron job '$cron_name' removed."
  else
    warn "Failed to remove cron job '$cron_name'. You may need to remove it manually."
  fi
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

list_workspaces() {
  CONFIG_PATH="$CONFIG_PATH" node -e '
    const fs = require("fs");
    try {
        const config = JSON.parse(fs.readFileSync(process.env.CONFIG_PATH, "utf8"));
        const ws = new Set();
        if (config.agents?.defaults?.workspace) ws.add(config.agents.defaults.workspace);
        if (Array.isArray(config.agents?.list)) {
            config.agents.list.forEach(a => { if (a.workspace) ws.add(a.workspace); });
        }
        console.log(Array.from(ws).join("\n"));
    } catch (e) { process.exit(0); }
  '
}

# ─── Feature: Memory Flush ───────────────────────────────────────────────────

configure_memory_flush() {
  printf "${YELLOW}Feature: Automatic Memory Flush${RESET}\n"
  echo "Automatically curates insights to ByteRover when the context window fills up."

  if confirm "Enable Automatic Memory Flush?"; then
    echo "Patching $CONFIG_PATH..."

    local system_prompt="Session nearing compaction. Store durable memories now."
    local prompt='Review the session for any architectural decisions, bug fixes, or new patterns. If found, run '\''brv curate "<summary of change>"'\'' to update the context tree. Also write personal notes to memory/YYYY-MM-DD.md. Reply NO_REPLY if nothing to store.'

    patch_memory_flush_config "$system_prompt" "$prompt"
    success "openclaw.json updated."
  else
    echo "Disabling Memory Flush..."
    remove_memory_flush_config
  fi
  echo ""
}

# ─── Feature: Daily Knowledge Mining ─────────────────────────────────────────

configure_daily_mining() {
  printf "${YELLOW}Feature: Daily Knowledge Mining (Cron)${RESET}\n"
  echo "Runs a daily agent job to read 'memory/YYYY-MM-DD.md', extract patterns, and store it in the ByteRover Context Tree."

  if ! confirm "Enable Daily Knowledge Mining?"; then
    echo "Disabling Daily Knowledge Mining..."
    remove_cron_job "ByteRover Knowledge Miner"
    echo ""
    return
  fi

  local cron_name="ByteRover Knowledge Miner"

  # Check if cron already exists
  local cron_list_tmp
  cron_list_tmp=$(mktemp)
  CLEANUP_FILES+=("$cron_list_tmp")

  local cron_rc=0
  openclaw cron list --json > "$cron_list_tmp" 2>/dev/null || cron_rc=$?

  if [ $cron_rc -ne 0 ] && [ ! -s "$cron_list_tmp" ]; then
    warn "Failed to list cron jobs (command failed). Skipping check."
    echo ""
    return
  fi

  local exists="false"
  if [ -s "$cron_list_tmp" ]; then
    exists=$(check_cron_exists "$cron_list_tmp" "$cron_name")
  fi

  if [[ "$exists" == "true" ]]; then
    printf "${YELLOW}Cron job '%s' already exists. Skipping creation.${RESET}\n" "$cron_name"
    echo ""
    return
  fi

  echo "Scheduling cron job via OpenClaw CLI..."

  local cron_prompt='DAILY KNOWLEDGE MINING:
1. Read the latest file in memory/ (e.g. memory/YYYY-MM-DD.md for today'\''s date).
2. Extract architectural decisions, reusable patterns, or critical bug fixes.
3. If valuable info is found, run '\''brv curate "<summary>"'\'' to save it to the Context Tree.'

  local cron_err_tmp
  cron_err_tmp=$(mktemp)
  CLEANUP_FILES+=("$cron_err_tmp")

  if openclaw cron add \
      --name "$cron_name" \
      --cron "0 9 * * *" \
      --session isolated \
      --message "$cron_prompt" \
      --announce < /dev/null 2>"$cron_err_tmp"; then
    success "Cron job scheduled successfully."
  else
    printf "${RED}[X] Failed to schedule cron job.${RESET}\n" >&2
    if [ -s "$cron_err_tmp" ]; then
      printf "${RED}    %s${RESET}\n" "$(cat "$cron_err_tmp")" >&2
    fi
  fi
  echo ""
}

# ─── Feature: ByteRover Context Plugin ───────────────────────────────────────

create_plugin_files() {
  mkdir -p "$PLUGIN_DIR"
  echo "Creating plugin files in $PLUGIN_DIR..."

  # Create index.ts
  cat > "$PLUGIN_DIR/index.ts" <<'EOF'
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export default function (api) {
  api.logger.info("[byterover] Loaded!");

  api.on("before_prompt_build", async (event, ctx) => {
    let userPrompt = event.prompt;

    if (!userPrompt) {
        // If prompt is empty or missing, try getting it from context messages
        const messages = ctx?.messages || [];
        const lastUserMessage = messages.slice().reverse().find(m => m.role === 'user');
        userPrompt = lastUserMessage?.content || "";
    }

    // Strip OpenClaw metadata headers if present to get the real user query
    userPrompt = userPrompt.replace(/^Conversation info \(untrusted metadata\):[\s\S]*?```json[\s\S]*?```\s*/i, "").trim();

    // If still empty, nothing to query
    if (!userPrompt) return;

    const queryText = userPrompt;

    try {
      api.logger.debug(`[byterover] Querying brv for: "${queryText}"`);

      // Use execFile to safely pass arguments without shell injection risks
      const { stdout } = await execFileAsync("brv", ["query", queryText], { timeout: 300000 });

      const brvOutput = stdout.trim();

      if (brvOutput) {
        const header = "\n\n## ByteRover Context (Auto-Enriched)\n";
        const injection = `${header}${brvOutput}\n`;

        api.logger.info(`[byterover] Injected ${brvOutput.length} chars of context.`);

        // Return context injection object
        return { prependContext: injection };
      }
    } catch (error) {
      // Ignore "command not found" or other predictable errors to reduce noise
      if (error.code !== 'ENOENT') {
        api.logger.warn(`[byterover] Query failed: ${error.message}`);
      } else {
        api.logger.debug("[byterover] 'brv' command not found in PATH.");
      }
    }
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

configure_context_plugin() {
  printf "${YELLOW}Feature: ByteRover Context Hooks (Plugin)${RESET}\n"
  echo "Installs a custom OpenClaw plugin (byterover) to inject memory context directly into your prompts."

  if ! confirm "Install ByteRover Context Plugin?"; then
    echo "Disabling ByteRover Context Plugin..."
    disable_plugin_in_config
    remove_plugin_files
    echo ""
    return
  fi

  create_plugin_files

  echo "Enabling plugin in $CONFIG_PATH..."
  enable_plugin_in_config
  success "Plugin enabled."
  echo ""
}

# ─── Workspace Protocol Updates ───────────────────────────────────────────────

update_agents_md() {
  local agents_md="$1"

  if [ ! -f "$agents_md" ]; then
    warn "AGENTS.md not found in $(dirname "$agents_md"). Skipping."
    return
  fi

  if grep -q "Knowledge Protocol" "$agents_md"; then
    echo "AGENTS.md already contains Knowledge Protocol."
    return
  fi

  cat >> "$agents_md" <<'AGENTS_EOF'

## Knowledge Protocol (ByteRover)
This agent uses ByteRover (`brv`) as its long-term structured memory.
1.  **Start:** Before answering complex questions, run `brv query "<topic>"` to load existing patterns.
2.  **Finish:** After completing a task, run `brv curate "<summary>"` to save knowledge.
3.  **Don't Guess:** If you don't know the project style, query it first.
4.  **Response Format:** When using knowledge, optionally cite it or mention storage:
    - "Based on brv contexts at `.brv/context-trees/...` and my research..."
    - "I also stored successfully knowledge to brv context-tree."
AGENTS_EOF
  success "Updated $agents_md"
}

update_tools_md() {
  local tools_md="$1"

  if [ ! -f "$tools_md" ]; then
    warn "TOOLS.md not found in $(dirname "$tools_md"). Skipping."
    return
  fi

  if grep -q "ByteRover (Memory)" "$tools_md"; then
    echo "TOOLS.md already contains Tool Reference."
    return
  fi

  cat >> "$tools_md" <<'TOOLS_EOF'

## ByteRover (Memory)
- **Query:** `brv query "auth patterns"` (Check existing knowledge)
- **Curate:** `brv curate "Auth uses JWT in cookies"` (Save new knowledge)
- **Sync:** `brv pull` / `brv push` (Sync with team - requires login)
TOOLS_EOF
  success "Updated $tools_md"
}

update_workspace_protocols() {
  info "Phase 3: Updating Protocols"

  local workspaces
  workspaces=$(list_workspaces)

  if [ -z "$workspaces" ]; then
    warn "No agent workspaces found in config. Skipping protocol updates."
    return
  fi

  while IFS= read -r ws; do
    [ -z "$ws" ] && continue

    # Expand tilde if present
    ws="${ws/#\~/$HOME}"

    if [ ! -d "$ws" ]; then
      warn "Workspace directory not found: $ws. Skipping."
      continue
    fi

    printf "Updating workspace: ${GREEN}%s${RESET}\n" "$ws"
    update_agents_md "$ws/AGENTS.md"
    update_tools_md "$ws/TOOLS.md"
  done <<< "$workspaces"
}

# ─── Output ───────────────────────────────────────────────────────────────────

print_success() {
  echo ""
  success "=== Installation Complete ==="
  echo "Your agent is now integrated with ByteRover."
}

# ─── Main ─────────────────────────────────────────────────────────────────────

main() {
  setup_cleanup

  info "=== ByteRover Integration Installer ==="
  echo "This script configures ByteRover as your openclaw's long-term memory."
  echo ""

  # Phase 1: Pre-flight Checks
  info "Phase 1: Pre-flight Checks"
  check_node
  check_clawhub
  check_brv_skill
  check_brv_cli
  check_openclaw_cli
  check_config
  echo ""

  # Phase 1.1: Storage & Backup
  setup_storage_dir
  backup_config
  echo ""

  # Phase 2: Configuration
  info "Phase 2: Configuration"
  info "--- Curate Story Options ---"
  configure_memory_flush
  configure_daily_mining
  info "--- Query Story Options ---"
  configure_context_plugin

  # Phase 3: Workspace Updates
  update_workspace_protocols
  echo ""

  print_success
}

main "$@"
