#!/bin/bash
set -e

# --- Output Helpers ---
if [ -n "$NO_COLOR" ] || [ ! -t 1 ]; then
    GREEN='' BLUE='' YELLOW='' RED='' NC=''
else
    GREEN='\033[0;32m'
    BLUE='\033[0;34m'
    YELLOW='\033[1;33m'
    RED='\033[0;31m'
    NC='\033[0m'
fi

info()    { printf '%b\n' "${BLUE}$*${NC}"; }
success() { printf '%b\n' "${GREEN}[ok] $*${NC}"; }
warn()    { printf '%b\n' "${YELLOW}[!] $*${NC}"; }
error()   { printf '%b\n' "${RED}[X] $*${NC}"; }

# --- Cleanup Trap ---
CLEANUP_FILES=()
cleanup() { rm -f "${CLEANUP_FILES[@]}"; }
trap cleanup EXIT

CONFIG_PATH="$HOME/.openclaw/openclaw.json"

info "=== ByteRover Integration Installer ==="
echo "This script configures ByteRover as your openclaw's long-term memory."
echo ""

# --- Phase 1: Pre-flight Checks ---
info "Phase 1: Pre-flight Checks"

# Check node (required for config patching)
if command -v node &> /dev/null; then
    success "Node is installed"
else
    error "Node is missing. Node.js is required to run this installer."
    exit 1
fi

# Check clawhub
if command -v clawhub &> /dev/null; then
    success "Clawhub is installed"
else
    error "Clawhub is missing. Please install it first via OpenClaw's skill."
    exit 1
fi

# Check brv skill (Auto-install if missing)
if clawhub list | grep -qw "byterover"; then
    success "ByteRover Skill is installed"
else
    warn "ByteRover Skill is missing. Installing byterover..."
    if clawhub install --force byterover; then
        success "ByteRover skill installed successfully"
    else
        error "Failed to install byterover."
        exit 1
    fi
fi

# Check byterover-cli (Must be pre-installed)
if command -v brv &> /dev/null; then
    success "ByteRover-cli npm is installed"
else
    error "ByteRover-cli npm is missing. Please install it first (npm install -g byterover-cli)."
    exit 1
fi

# Check openclaw CLI
if ! command -v openclaw &> /dev/null; then
    error "OpenClaw CLI is missing. Cannot schedule OpenClaw cron jobs."
    exit 1
fi

# Check config file exists
if [ ! -f "$CONFIG_PATH" ]; then
    error "Config file not found at $CONFIG_PATH."
    echo "Please install openclaw first (https://docs.openclaw.ai/install#npm-pnpm) to generate the configuration."
    exit 1
fi

# Validate config is parseable JSON
if ! CONFIG_PATH="$CONFIG_PATH" node -e 'JSON.parse(require("fs").readFileSync(process.env.CONFIG_PATH, "utf8"))' 2>/dev/null; then
    error "Config file at $CONFIG_PATH is not valid JSON."
    exit 1
fi

echo ""

# --- Phase 1.1: ByteRover Storage Location ---
info "Phase 1.1: ByteRover Storage Location"

BRV_STORAGE="$HOME/.openclaw"

printf '%b\n' "ByteRover Context Tree will be stored in: ${GREEN}$BRV_STORAGE/.brv${NC}"
echo "This allows all OpenClaw agents to share the same knowledge base."

if [ ! -d "$BRV_STORAGE" ]; then
    warn "Directory does not exist. Creating..."
    mkdir -p "$BRV_STORAGE"
fi

# --- Backup config before modifications ---
CONFIG_BACKUP="${CONFIG_PATH}.bak.$(date +%Y%m%d%H%M%S)"
cp "$CONFIG_PATH" "$CONFIG_BACKUP"
echo "Backed up config to $CONFIG_BACKUP"

# --- Phase 2: Configuration ---
info "Phase 2: Configuration"

# 2.1 Curate Story Options
info "--- Curate Story Options ---"

# Automatic Memory Flush
printf '%b\n' "${YELLOW}Feature: Automatic Memory Flush${NC}"
echo "Automatically curates insights to ByteRover when the context window fills up."
if [ -t 0 ]; then
    read -p "Enable Automatic Memory Flush? (y/N): " FLUSH_CONFIRM
else
    read -p "Enable Automatic Memory Flush? (y/N): " FLUSH_CONFIRM < /dev/tty
fi

if [[ "$FLUSH_CONFIRM" =~ ^[Yy]$ ]]; then
    echo "Patching $CONFIG_PATH..."

    FLUSH_SYSTEM_PROMPT="Session nearing compaction. Store durable memories now."
    FLUSH_PROMPT="Review the session for any architectural decisions, bug fixes, or new patterns. If found, run 'cd ~/.openclaw && brv curate \"<summary of change>\"' to update the context tree. Also write personal notes to memory/YYYY-MM-DD.md. Reply NO_REPLY if nothing to store."

    FLUSH_SYSTEM_PROMPT="$FLUSH_SYSTEM_PROMPT" FLUSH_PROMPT="$FLUSH_PROMPT" CONFIG_PATH="$CONFIG_PATH" node -e '
    const fs = require("fs");
    const configPath = process.env.CONFIG_PATH;
    const systemPrompt = process.env.FLUSH_SYSTEM_PROMPT;
    const prompt = process.env.FLUSH_PROMPT;
    try {
        const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

        config.agents = config.agents || {};
        config.agents.defaults = config.agents.defaults || {};
        config.agents.defaults.compaction = config.agents.defaults.compaction || {};

        config.agents.defaults.compaction.reserveTokensFloor = 20000;
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
    success "openclaw.json updated."
else
    echo "Skipping Memory Flush."
fi
echo ""

# Daily Knowledge Mining (Cron)
printf '%b\n' "${YELLOW}Feature: Daily Knowledge Mining (Cron)${NC}"
echo "Runs a daily agent job to read 'memory/YYYY-MM-DD.md', extract patterns, and store it in the ByteRover Context Tree."
if [ -t 0 ]; then
    read -p "Enable Daily Knowledge Mining? (y/N): " CRON_CONFIRM
else
    read -p "Enable Daily Knowledge Mining? (y/N): " CRON_CONFIRM < /dev/tty
fi

if [[ "$CRON_CONFIRM" =~ ^[Yy]$ ]]; then
    CRON_NAME="ByteRover Knowledge Miner"

    # Check if cron already exists
    CRON_LIST_TMP=$(mktemp)
    CLEANUP_FILES+=("$CRON_LIST_TMP")

    cron_rc=0
    openclaw cron list --json > "$CRON_LIST_TMP" 2>/dev/null || cron_rc=$?

    if [ $cron_rc -ne 0 ] && [ ! -s "$CRON_LIST_TMP" ]; then
        warn "Failed to list cron jobs (command failed). Skipping check."
    else
        EXISTS=false

        if [ -s "$CRON_LIST_TMP" ]; then
            EXISTS=$(CRON_LIST_TMP="$CRON_LIST_TMP" CRON_NAME="$CRON_NAME" node -e '
                try {
                    const fs = require("fs");
                    const content = fs.readFileSync(process.env.CRON_LIST_TMP, "utf8").trim();
                    if (!content) { console.log("false"); process.exit(0); }
                    const json = JSON.parse(content);
                    const jobs = json.jobs || [];
                    const exists = jobs.some(j => j.name === process.env.CRON_NAME);
                    console.log(exists ? "true" : "false");
                } catch(e) { console.log("false"); }
            ')
        fi

        if [[ "$EXISTS" == "true" ]]; then
            printf '%b\n' "${YELLOW}Cron job '$CRON_NAME' already exists. Skipping creation.${NC}"
        else
            echo "Scheduling cron job via OpenClaw CLI..."

            CRON_PROMPT='DAILY KNOWLEDGE MINING:
1. Read the latest file in memory/ (e.g. memory/YYYY-MM-DD.md for today'\''s date).
2. Extract architectural decisions, reusable patterns, or critical bug fixes.
3. If valuable info is found, run '\''cd ~/.openclaw && brv curate "<summary>"'\'' to save it to the Context Tree.'

            CRON_ERR_TMP=$(mktemp)
            CLEANUP_FILES+=("$CRON_ERR_TMP")

            if openclaw cron add \
                --name "$CRON_NAME" \
                --cron "0 9 * * *" \
                --session isolated \
                --message "$CRON_PROMPT" \
                --announce < /dev/null 2>"$CRON_ERR_TMP"; then
                success "Cron job scheduled successfully."
            else
                error "Failed to schedule cron job."
                if [ -s "$CRON_ERR_TMP" ]; then
                    printf '%b\n' "${RED}    $(cat "$CRON_ERR_TMP")${NC}"
                fi
            fi
        fi
    fi
else
    echo "Skipping Cron setup."
fi
echo ""

# 2.2 Query Story Options
info "--- Query Story Options ---"

# ByteRover Plugin (Hooks)
printf '%b\n' "${YELLOW}Feature: ByteRover Context Hooks (Plugin)${NC}"
echo "Installs a custom OpenClaw plugin (byterover) to inject memory context directly into your prompts."

if [ -t 0 ]; then
    read -p "Install ByteRover Context Plugin? (y/N): " PLUGIN_CONFIRM || PLUGIN_CONFIRM="n"
else
    if ! read -p "Install ByteRover Context Plugin? (y/N): " PLUGIN_CONFIRM < /dev/tty; then
         warn "Could not read input from /dev/tty. Defaulting to No."
         PLUGIN_CONFIRM="n"
    fi
fi

if [[ "$PLUGIN_CONFIRM" =~ ^[Yy]$ ]]; then
    PLUGIN_DIR="$HOME/.openclaw/extensions/byterover"
    mkdir -p "$PLUGIN_DIR"

    echo "Creating plugin files in $PLUGIN_DIR..."

    # Create index.ts (quoted heredoc to prevent shell interpolation)
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

    // Truncate to 100 chars for query efficiency
    const queryText = userPrompt.slice(0, 100);

    try {
      api.logger.debug(`[byterover] Querying brv for: "${queryText}"`);

      // Use execFile to safely pass arguments without shell injection risks
      // IMPORTANT: Run from ~/.openclaw as the CWD
      const brvCwd = process.env.HOME + '/.openclaw';
      const { stdout } = await execFileAsync("brv", ["query", queryText], { cwd: brvCwd, timeout: 60000 }); // 60s timeout

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

    # Enable in openclaw.json
    echo "Enabling plugin in $CONFIG_PATH..."
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
    success "Plugin enabled."
else
    echo "Skipping Plugin setup."
fi
echo ""

# --- Phase 3: Docs Update (Silent - updates all detected workspaces) ---
info "Phase 3: Updating Protocols"

WORKSPACES=$(CONFIG_PATH="$CONFIG_PATH" node -e '
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
')

if [ -z "$WORKSPACES" ]; then
    warn "No agent workspaces found in config. Skipping protocol updates."
else
    while IFS= read -r ws; do
        [ -z "$ws" ] && continue
        # Expand tilde if present
        ws="${ws/#\~/$HOME}"

        if [ ! -d "$ws" ]; then
            warn "Workspace directory not found: $ws. Skipping."
            continue
        fi

        printf '%b\n' "Updating workspace: ${GREEN}$ws${NC}"

        AGENTS_MD="$ws/AGENTS.md"
        TOOLS_MD="$ws/TOOLS.md"

        # Update AGENTS.md
        if [ -f "$AGENTS_MD" ]; then
            if ! grep -q "Knowledge Protocol" "$AGENTS_MD"; then
                cat >> "$AGENTS_MD" <<'AGENTS_EOF'

## Knowledge Protocol (ByteRover)
This agent uses ByteRover (`brv`) as its long-term structured memory.
0.  **Initialization** Ensure the brv operation runs via the `brv` command in the `~/.openclaw` workspace.
1.  **Start:** Before answering complex questions, run `cd ~/.openclaw && brv query "<topic>"` to load existing patterns.
2.  **Finish:** After completing a task, run `cd ~/.openclaw && brv curate "<summary>"` to save knowledge.
3.  **Don't Guess:** If you don't know the project style, query it first.
4.  **Response Format:** When using knowledge, optionally cite it or mention storage:
    - "Based on brv contexts at `~/.openclaw/.brv/context-trees/...` and my research..."
    - "I also stored successfully knowledge to brv context-tree."
AGENTS_EOF
                success "Updated $ws/AGENTS.md"
            else
                echo "AGENTS.md already contains Knowledge Protocol."
            fi
        else
            warn "AGENTS.md not found in $ws. Skipping."
        fi

        # Update TOOLS.md
        if [ -f "$TOOLS_MD" ]; then
            if ! grep -q "ByteRover (Memory)" "$TOOLS_MD"; then
                cat >> "$TOOLS_MD" <<'TOOLS_EOF'

## ByteRover (Memory)
- **Query:** `brv query "auth patterns"` (Check existing knowledge)
- **Curate:** `brv curate "Auth uses JWT in cookies"` (Save new knowledge)
- **Sync:** `brv pull` / `brv push` (Sync with team - requires login)
TOOLS_EOF
                success "Updated $ws/TOOLS.md"
            else
                echo "TOOLS.md already contains Tool Reference."
            fi
        else
            warn "TOOLS.md not found in $ws. Skipping."
        fi

    done <<< "$WORKSPACES"
fi

echo ""
success "=== Installation Complete ==="
echo "Your agent is now integrated with ByteRover."
