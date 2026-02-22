#!/bin/bash
set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

CONFIG_PATH="$HOME/.openclaw/openclaw.json"

echo -e "${BLUE}=== ByteRover Integration Installer ===${NC}"
echo "This script configures ByteRover as your agent's long-term memory."
echo ""

# --- Phase 1: Pre-flight Checks ---
echo -e "${BLUE}Phase 1: Pre-flight Checks${NC}"

# Check clawhub
if command -v clawhub &> /dev/null; then
    echo -e "${GREEN}[âœ“] clawhub is installed${NC}"
else
    echo -e "${RED}[X] clawhub is missing.${NC} Please install it first."
    exit 1
fi

# Check brv (Auto-install if missing)
if command -v brv &> /dev/null; then
    echo -e "${GREEN}[âœ“] brv (ByteRover Skill) is installed${NC}"
else
    echo -e "${YELLOW}[!] brv is missing. Installing byterover-headless...${NC}"
    if clawhub install --force byterover-headless; then
        echo -e "${GREEN}[âœ“] brv skill installed successfully${NC}"
    else
        echo -e "${RED}[X] Failed to install byterover-headless.${NC}"
        exit 1
    fi
fi

# Install/Update byterover-cli (Explicit)
echo -e "${YELLOW}Installing byterover-cli via npm...${NC}"
if npm install -g byterover-cli; then
    echo -e "${GREEN}[âœ“] byterover-cli installed successfully${NC}"
else
    echo -e "${RED}[X] Failed to install byterover-cli. Check permissions.${NC}"
    exit 1
fi

# Check openclaw CLI
if ! command -v openclaw &> /dev/null; then
    echo -e "${RED}[X] openclaw CLI is missing.${NC} Cannot schedule cron jobs."
    exit 1
fi

echo ""

# --- Phase 1.1: Workspace Discovery ---
echo -e "${BLUE}Phase 1.1: Workspace Discovery${NC}"

if [ ! -f "$CONFIG_PATH" ]; then
    echo -e "${RED}Error: OpenClaw config not found at $CONFIG_PATH${NC}"
    exit 1
fi

# Use node to parse openclaw.json and find workspaces
WORKSPACES=$(node -e "
try {
    const fs = require('fs');
    const config = JSON.parse(fs.readFileSync('$CONFIG_PATH', 'utf8'));
    const workspaces = new Set();
    
    // Check defaults
    if (config.agents?.defaults?.workspace) {
        workspaces.add(config.agents.defaults.workspace);
    }
    
    // Check agent list
    if (Array.isArray(config.agents?.list)) {
        config.agents.list.forEach(a => {
            if (a.workspace) workspaces.add(a.workspace);
        });
    }
    
    console.log(Array.from(workspaces).join('\n'));
} catch (e) {
    console.error(e);
    process.exit(1);
}
")

# Convert to array
IFS=$'\n' read -rd '' -a WS_ARRAY <<< "$WORKSPACES" || true

echo "Found the following OpenClaw workspaces:"
i=1
for ws in "${WS_ARRAY[@]}"; do
    echo "  [$i] $ws"
    ((i++))
done

# Default option ( ~/.openclaw/workspace/.brv is not standard, sticking to discovered or custom)
echo "  [c] Custom path"

# Force read from /dev/tty to support curl | bash
if [ -t 0 ]; then
    read -p "Which workspace should host the .brv Context Tree? [1]: " WS_CHOICE
else
    read -p "Which workspace should host the .brv Context Tree? [1]: " WS_CHOICE < /dev/tty
fi

WS_CHOICE=${WS_CHOICE:-1}

TARGET_WORKSPACE=""

if [[ "$WS_CHOICE" == "c" ]]; then
    if [ -t 0 ]; then
        read -p "Enter full path: " TARGET_WORKSPACE
    else
        read -p "Enter full path: " TARGET_WORKSPACE < /dev/tty
    fi
else
    # Validate input is a number
    if ! [[ "$WS_CHOICE" =~ ^[0-9]+$ ]]; then
        echo -e "${RED}Invalid selection: $WS_CHOICE${NC}"
        exit 1
    fi
    INDEX=$((WS_CHOICE-1))
    TARGET_WORKSPACE="${WS_ARRAY[$INDEX]}"
fi

# Expand tilde if present
TARGET_WORKSPACE="${TARGET_WORKSPACE/#\~/$HOME}"

if [ -z "$TARGET_WORKSPACE" ]; then
    echo -e "${RED}Invalid workspace selection.${NC}"
    exit 1
fi

echo -e "Selected Workspace: ${GREEN}$TARGET_WORKSPACE${NC}"

# Initialize BRV
if [ ! -d "$TARGET_WORKSPACE" ]; then
    echo -e "${YELLOW}Workspace does not exist. Creating...${NC}"
    mkdir -p "$TARGET_WORKSPACE"
fi

echo "Initializing ByteRover in workspace..."
cd "$TARGET_WORKSPACE"
# Try init (ignore error if already initialized)
brv init --headless --format json || true
echo -e "${GREEN}[âœ“] ByteRover initialized in $TARGET_WORKSPACE/.brv${NC}"
echo ""

# --- Phase 2: Configuration ---
echo -e "${BLUE}Phase 2: Configuration${NC}"

# 2.1 Memory Flush
echo -e "${YELLOW}Feature: Automatic Memory Flush${NC}"
echo "Automatically curates insights to ByteRover when the context window fills up."
if [ -t 0 ]; then
    read -p "Enable Automatic Memory Flush? (y/N): " FLUSH_CONFIRM
else
    read -p "Enable Automatic Memory Flush? (y/N): " FLUSH_CONFIRM < /dev/tty
fi

if [[ "$FLUSH_CONFIRM" =~ ^[Yy]$ ]]; then
    echo "Patching $CONFIG_PATH..."
    
    # Node script to patch config safely
    node -e "
    const fs = require('fs');
    const path = '$CONFIG_PATH';
    try {
        const config = JSON.parse(fs.readFileSync(path, 'utf8'));
        
        // Ensure structure exists
        config.agents = config.agents || {};
        config.agents.defaults = config.agents.defaults || {};
        config.agents.defaults.compaction = config.agents.defaults.compaction || {};
        config.agents.defaults.compaction.memoryFlush = config.agents.defaults.compaction.memoryFlush || {};
        
        // Apply setting
        config.agents.defaults.compaction.memoryFlush.enabled = true;
        config.agents.defaults.compaction.memoryFlush.prompt = 'Review the session for any architectural decisions, bug fixes, or new patterns. If found, run \'brv curate \"<summary of change>\"\' to update the context tree. Also write personal notes to memory/YYYY-MM-DD.md. Reply NO_REPLY if done.';
        
        fs.writeFileSync(path, JSON.stringify(config, null, 2));
        console.log('Config updated successfully.');
    } catch (e) {
        console.error('Failed to patch config:', e);
        process.exit(1);
    }
    "
    # Trigger reload (optional, but good practice if CLI supports it, otherwise gateway auto-reloads on file change)
    echo -e "${GREEN}[âœ“] openclaw.json updated.${NC}"
else
    echo "Skipping Memory Flush."
fi
echo ""

# 2.2 Cron (Knowledge Mining)
echo -e "${YELLOW}Feature: Daily Knowledge Mining (Cron)${NC}"
echo "Runs a daily agent job to read 'memory/YYYY-MM-DD.md', extract patterns, and sync."
if [ -t 0 ]; then
    read -p "Enable Daily Knowledge Mining? (y/N): " CRON_CONFIRM
else
    read -p "Enable Daily Knowledge Mining? (y/N): " CRON_CONFIRM < /dev/tty
fi

if [[ "$CRON_CONFIRM" =~ ^[Yy]$ ]]; then
    echo "Scheduling cron job via OpenClaw CLI..."
    
    CRON_PROMPT="DAILY KNOWLEDGE MINING:
1. Read the latest file in memory/ (e.g. memory/$(date +%Y-%m-%d).md).
2. Extract architectural decisions, reusable patterns, or critical bug fixes.
3. If valuable info is found, run 'brv curate \"<summary>\"' to save it to the Context Tree."

    # Use openclaw cron add
    if openclaw cron add \
        --name "ByteRover Knowledge Miner" \
        --cron "0 9 * * *" \
        --session isolated \
        --message "$CRON_PROMPT" \
        --announce < /dev/null; then
        echo -e "${GREEN}[âœ“] Cron job scheduled successfully.${NC}"
    else
        echo -e "${RED}[X] Failed to schedule cron job.${NC}"
    fi
else
    echo "Skipping Cron setup."
fi
echo ""

# 2.3 ByteRover Plugin
echo -e "${YELLOW}Feature: ByteRover Context Plugin${NC}"
echo "Installs a custom OpenClaw plugin (byterover) to inject memory context directly into sessions."
if [ -t 0 ]; then
    read -p "Install ByteRover Context Plugin? (y/N): " PLUGIN_CONFIRM
else
    read -p "Install ByteRover Context Plugin? (y/N): " PLUGIN_CONFIRM < /dev/tty
fi

if [[ "$PLUGIN_CONFIRM" =~ ^[Yy]$ ]]; then
    PLUGIN_DIR="$HOME/.openclaw/extensions/byterover"
    mkdir -p "$PLUGIN_DIR"
    
    echo "Creating plugin files in $PLUGIN_DIR..."
    
    # Create index.ts
    cat > "$PLUGIN_DIR/index.ts" <<EOF
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export default function (api) {
  api.logger.info("[brv-context] Loaded!");

  api.on("before_prompt_build", async (event, ctx) => {
    let userPrompt = event.prompt;

    if (!userPrompt) {
        // If prompt is empty or missing, try getting it from context messages
        const messages = ctx?.messages || [];
        const lastUserMessage = messages.slice().reverse().find(m => m.role === 'user');
        userPrompt = lastUserMessage?.content || "";
    }

    // Strip OpenClaw metadata headers if present to get the real user query
    userPrompt = userPrompt.replace(/^Conversation info \(untrusted metadata\):[\s\S]*?\`\`\`json[\s\S]*?\`\`\`\s*/i, "").trim();

    // If still empty, nothing to query
    if (!userPrompt) return;

    // Truncate to 100 chars for query efficiency
    const queryText = userPrompt.slice(0, 100);

    try {
      api.logger.debug(\`[brv-context] Querying brv for: "\${queryText}"\`);

      // Use execFile to safely pass arguments without shell injection risks
      const { stdout } = await execFileAsync("brv", ["query", queryText], { timeout: 60000 }); // 60s timeout

      const brvOutput = stdout.trim();

      if (brvOutput) {
        const header = "\n\n## ByteRover Context (Auto-Enriched)\n";
        const injection = \`\${header}\${brvOutput}\n\`;

        api.logger.info(\`[brv-context] Injected \${brvOutput.length} chars of context.\`);
        
        // Return context injection object
        return { prependContext: injection };
      }
    } catch (error) {
      // Ignore "command not found" or other predictable errors to reduce noise
      if (error.code !== 'ENOENT') {
        api.logger.warn(\`[brv-context] Query failed: \${error.message}\`);
      } else {
        api.logger.debug("[brv-context] 'brv' command not found in PATH.");
      }
    }
  });
}
EOF

    # Create openclaw.plugin.json
    cat > "$PLUGIN_DIR/openclaw.plugin.json" <<EOF
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

    echo -e "${GREEN}[âœ“] Plugin files created.${NC}"

    # Enable in openclaw.json
    echo "Enabling plugin in $CONFIG_PATH..."
    node -e "
    const fs = require('fs');
    const path = '$CONFIG_PATH';
    try {
        const config = JSON.parse(fs.readFileSync(path, 'utf8'));
        config.plugins = config.plugins || {};
        config.plugins.entries = config.plugins.entries || {};
        config.plugins.entries['byterover'] = { enabled: true };
        fs.writeFileSync(path, JSON.stringify(config, null, 2));
        console.log('Plugin enabled in config.');
    } catch (e) {
        console.error('Failed to update config for plugin:', e);
        process.exit(1);
    }
    "
    echo -e "${GREEN}[âœ“] Plugin enabled.${NC}"
else
    echo "Skipping Plugin setup."
fi
echo ""

# --- Phase 3: Update Docs ---
echo -e "${BLUE}Phase 3: Updating Protocols${NC}"

AGENTS_MD="$TARGET_WORKSPACE/AGENTS.md"
TOOLS_MD="$TARGET_WORKSPACE/TOOLS.md"

# Update AGENTS.md
if [ -f "$AGENTS_MD" ]; then
    if ! grep -q "Knowledge Protocol" "$AGENTS_MD"; then
        echo "Appending Knowledge Protocol to AGENTS.md..."
        cat >> "$AGENTS_MD" <<EOF

## ðŸ§  Knowledge Protocol (ByteRover)
This agent uses ByteRover (\`brv\`) as its long-term structured memory.
0.  **Initialization** Make sure spawn brv daemon started by \`brv\` command in the current workspace. If "brv" already started, DON'T start again
1.  **Start:** Before answering complex questions, run \`brv query "<topic>"\` to load existing patterns.
2.  **Finish:** After completing a task, run \`brv curate "<summary>"\` to save knowledge.
3.  **Don't Guess:** If you don't know the project style, query it first.
EOF
        echo -e "${GREEN}[âœ“] Updated AGENTS.md${NC}"
    else
        echo "AGENTS.md already contains Knowledge Protocol."
    fi
else
    echo -e "${YELLOW}Warning: AGENTS.md not found in workspace.${NC}"
fi

# Update TOOLS.md
if [ -f "$TOOLS_MD" ]; then
    if ! grep -q "ByteRover (Memory)" "$TOOLS_MD"; then
        echo "Appending Tool Reference to TOOLS.md..."
        cat >> "$TOOLS_MD" <<EOF

## ByteRover (Memory)
- **Query:** \`brv query "auth patterns"\` (Check existing knowledge)
- **Curate:** \`brv curate "Auth uses JWT in cookies"\` (Save new knowledge)
- **Sync:** \`brv pull\` / \`brv push\` (Sync with team - requires login)
EOF
        echo -e "${GREEN}[âœ“] Updated TOOLS.md${NC}"
    else
        echo "TOOLS.md already contains Tool Reference."
    fi
else
    echo -e "${YELLOW}Warning: TOOLS.md not found in workspace.${NC}"
fi

echo ""
echo -e "${GREEN}=== Installation Complete ===${NC}"
echo "Your agent is now integrated with ByteRover."

# Ensure ByteRover daemon is ready (Sub-process)
echo ""
echo -e "${BLUE}Starting ByteRover daemon in ${TARGET_WORKSPACE}...${NC}"
cd "$TARGET_WORKSPACE"

# Run status to wake the daemon (ignore output)
# This spawns the detached daemon process if not running
if brv status >/dev/null 2>&1; then
    echo -e "${GREEN}[âœ“] ByteRover daemon is active.${NC}"
else
    echo -e "${YELLOW}Starting ByteRover daemon...${NC}"
    # Just in case status doesn't spawn it (though it should), we run it
    brv status >/dev/null 2>&1 || true
    echo -e "${GREEN}[âœ“] ByteRover daemon started.${NC}"
fi

echo ""
echo -e "${GREEN}=== Installation Complete ===${NC}"
echo "ByteRover is ready. Your agent will now manage memory automatically."