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
    echo -e "${GREEN}[✓] clawhub is installed${NC}"
else
    echo -e "${RED}[X] clawhub is missing.${NC} Please install it first."
    exit 1
fi

# Check brv (Auto-install if missing)
if clawhub list | grep -q "byterover"; then
    echo -e "${GREEN}[✓] brv (ByteRover Skill) is installed${NC}"
else
    echo -e "${YELLOW}[!] brv is missing. Installing byterover...${NC}"
    if clawhub install --force byterover; then
        echo -e "${GREEN}[✓] brv skill installed successfully${NC}"
    else
        echo -e "${RED}[X] Failed to install byterover.${NC}"
        exit 1
    fi
fi

# Check byterover-cli (Must be pre-installed)
if command -v byterover-cli &> /dev/null; then
    echo -e "${GREEN}[✓] byterover-cli is installed${NC}"
elif command -v brv &> /dev/null; then
    echo -e "${GREEN}[✓] brv is installed${NC}"
else
    echo -e "${RED}[X] byterover-cli (brv) is missing.${NC} Please install it first (npm install -g byterover-cli)."
    exit 1
fi

# Check openclaw CLI
if ! command -v openclaw &> /dev/null; then
    echo -e "${RED}[X] openclaw CLI is missing.${NC} Cannot schedule cron jobs."
    exit 1
fi

echo ""

# --- Phase 1.1: ByteRover Storage Location ---
echo -e "${BLUE}Phase 1.1: ByteRover Storage Location${NC}"

# Default storage is ~/.openclaw to share context across agents
BRV_STORAGE="$HOME/.openclaw"

echo -e "ByteRover Context Tree will be stored in: ${GREEN}$BRV_STORAGE/.brv${NC}"
echo "This allows all agents to share the same knowledge base."

if [ ! -d "$BRV_STORAGE" ]; then
    echo -e "${YELLOW}Directory does not exist. Creating...${NC}"
    mkdir -p "$BRV_STORAGE"
fi

# --- Phase 2: Configuration ---
echo -e "${BLUE}Phase 2: Configuration${NC}"

# 2.1 Curate Story Options
echo -e "${BLUE}--- Curate Story Options ---${NC}"

# Automatic Memory Flush
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
        config.agents.defaults.compaction.memoryFlush.prompt = 'Review the session for any architectural decisions, bug fixes, or new patterns. If found, run \'cd ~/.openclaw && brv curate \"<summary of change>\"\' to update the context tree. Also write personal notes to memory/YYYY-MM-DD.md. Reply NO_REPLY if done.';
        
        fs.writeFileSync(path, JSON.stringify(config, null, 2));
        console.log('Config updated successfully.');
    } catch (e) {
        console.error('Failed to patch config:', e);
        process.exit(1);
    }
    "
    echo -e "${GREEN}[✓] openclaw.json updated.${NC}"
else
    echo "Skipping Memory Flush."
fi
echo ""

# Daily Knowledge Mining (Cron)
echo -e "${YELLOW}Feature: Daily Knowledge Mining (Cron)${NC}"
echo "Runs a daily agent job to read 'memory/YYYY-MM-DD.md', extract patterns, and sync."
if [ -t 0 ]; then
    read -p "Enable Daily Knowledge Mining? (y/N): " CRON_CONFIRM
else
    read -p "Enable Daily Knowledge Mining? (y/N): " CRON_CONFIRM < /dev/tty
fi

if [[ "$CRON_CONFIRM" =~ ^[Yy]$ ]]; then
    CRON_NAME="ByteRover Knowledge Miner"
    
    # Check if cron already exists (robust check using JSON)
    CRON_LIST_TMP=$(mktemp)
    
    # 1. Fetch JSON output to temp file
    # We use a || true to ensure the command doesn't trigger set -e if it returns non-zero (though it shouldn't for list)
    if openclaw cron list --json > "$CRON_LIST_TMP" 2>/dev/null || [ -s "$CRON_LIST_TMP" ]; then
        
        # 2. Use jq if available for reliable parsing, fallback to python/node/grep
        EXISTS=false
        
        # Check if file is empty or invalid JSON
        if [ ! -s "$CRON_LIST_TMP" ]; then
             echo "Debug: Cron list returned empty. Assuming no jobs."
             EXISTS="false"
        else
            # Try node (most likely available given openclaw environment)
            if command -v node &> /dev/null; then
                EXISTS=$(node -e "
                    try {
                        const fs = require('fs');
                        const content = fs.readFileSync('$CRON_LIST_TMP', 'utf8').trim();
                        if (!content) { console.log('false'); process.exit(0); }
                        const json = JSON.parse(content);
                        const jobs = json.jobs || [];
                        const exists = jobs.some(j => j.name === '$CRON_NAME');
                        console.log(exists ? 'true' : 'false');
                    } catch(e) { console.log('false'); }
                ")
            elif grep -Fq "\"name\": \"$CRON_NAME\"" "$CRON_LIST_TMP" || grep -Fq "\"name\":\"$CRON_NAME\"" "$CRON_LIST_TMP"; then
                # Fallback to grep with/without space
                EXISTS=true
            fi
        fi

        if [[ "$EXISTS" == "true" ]]; then
            echo -e "${YELLOW}Cron job '$CRON_NAME' already exists. Skipping creation.${NC}"
        else
            echo "Scheduling cron job via OpenClaw CLI..."
            
            CRON_PROMPT="DAILY KNOWLEDGE MINING:
1. Read the latest file in memory/ (e.g. memory/$(date +%Y-%m-%d).md).
2. Extract architectural decisions, reusable patterns, or critical bug fixes.
3. If valuable info is found, run 'cd ~/.openclaw && brv curate \"<summary>\"' to save it to the Context Tree."

            # Use openclaw cron add
            if openclaw cron add \
                --name "$CRON_NAME" \
                --cron "0 9 * * *" \
                --session isolated \
                --message "$CRON_PROMPT" \
                --announce < /dev/null > /dev/null 2>&1; then
                echo -e "${GREEN}[✓] Cron job scheduled successfully.${NC}"
            else
                echo -e "${RED}[X] Failed to schedule cron job (or it might have been created silently).${NC}"
            fi
        fi
    else
        echo -e "${RED}[!] Failed to list cron jobs (command failed). Skipping check.${NC}"
    fi
    rm "$CRON_LIST_TMP"
else
    echo "Skipping Cron setup."
fi
echo ""

echo "Debug: Proceeding to Query Story Options..."

# 2.2 Query Story Options
echo -e "${BLUE}--- Query Story Options ---${NC}"

echo "Debug: Configuring ByteRover Plugin..."

# ByteRover Plugin (Hooks)
echo -e "${YELLOW}Feature: ByteRover Context Hooks (Plugin)${NC}"
echo "Installs a custom OpenClaw plugin (byterover) to inject memory context directly into sessions."

echo "Debug: Prompting for plugin installation..."

if [ -t 0 ]; then
    echo "Debug: Reading from stdin (TTY)..."
    read -p "Install ByteRover Context Plugin? (y/N): " PLUGIN_CONFIRM || PLUGIN_CONFIRM="n"
else
    echo "Debug: Reading from /dev/tty..."
    # Attempt to read from /dev/tty, default to "n" on failure to prevent script exit
    if ! read -p "Install ByteRover Context Plugin? (y/N): " PLUGIN_CONFIRM < /dev/tty; then
         echo -e "${RED}Warning: Could not read input from /dev/tty. Defaulting to No.${NC}"
         PLUGIN_CONFIRM="n"
    fi
fi
echo "Debug: Plugin confirmation received: '$PLUGIN_CONFIRM'"

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
      // IMPORTANT: Run from ~/.openclaw as the CWD
      const brvCwd = process.env.HOME + '/.openclaw';
      const { stdout } = await execFileAsync("brv", ["query", queryText], { cwd: brvCwd, timeout: 60000 }); // 60s timeout

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

    echo -e "${GREEN}[✓] Plugin files created.${NC}"

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
    echo -e "${GREEN}[✓] Plugin enabled.${NC}"
else
    echo "Skipping Plugin setup."
fi
echo ""

# --- Phase 3: Docs Update ---
echo -e "${BLUE}Phase 3: Updating Protocols${NC}"

# 3.1: Agent Workspace Selection
echo -e "${BLUE}Phase 3.1: Main Agent Workspace Selection${NC}"
echo "We need to update AGENTS.md and TOOLS.md with ByteRover protocols."

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

echo "Found the following agent workspaces:"
i=1
for ws in "${WS_ARRAY[@]}"; do
    echo "  [$i] $ws"
    ((i++))
done

# Default option
echo "  [c] Custom path"

if [ -t 0 ]; then
    read -p "Select the agent workspace to update [1]: " WS_CHOICE
else
    # Try reading from /dev/tty, if fail, default to 1 (first workspace)
    if ! read -p "Select the agent workspace to update [1]: " WS_CHOICE < /dev/tty; then
         echo -e "${RED}Warning: Could not read input from /dev/tty. Defaulting to 1.${NC}"
         WS_CHOICE="1"
    fi
fi

WS_CHOICE=${WS_CHOICE:-1}
AGENT_WORKSPACE=""

if [[ "$WS_CHOICE" == "c" ]]; then
    if [ -t 0 ]; then
        read -p "Enter full path: " AGENT_WORKSPACE
    else
        read -p "Enter full path: " AGENT_WORKSPACE < /dev/tty
    fi
else
    # Validate input is a number
    if ! [[ "$WS_CHOICE" =~ ^[0-9]+$ ]]; then
        echo -e "${RED}Invalid selection: $WS_CHOICE${NC}"
        exit 1
    fi
    INDEX=$((WS_CHOICE-1))
    AGENT_WORKSPACE="${WS_ARRAY[$INDEX]}"
fi

# Expand tilde if present
AGENT_WORKSPACE="${AGENT_WORKSPACE/#\~/$HOME}"

if [ -z "$AGENT_WORKSPACE" ]; then
    echo -e "${RED}Invalid workspace selection.${NC}"
    exit 1
fi

echo -e "Selected Agent Workspace: ${GREEN}$AGENT_WORKSPACE${NC}"
echo ""

AGENTS_MD="$AGENT_WORKSPACE/AGENTS.md"
TOOLS_MD="$AGENT_WORKSPACE/TOOLS.md"

# Update AGENTS.md
if [ -f "$AGENTS_MD" ]; then
    if ! grep -q "Knowledge Protocol" "$AGENTS_MD"; then
        echo "Appending Knowledge Protocol to AGENTS.md..."
        cat >> "$AGENTS_MD" <<EOF

## 🧠 Knowledge Protocol (ByteRover)
This agent uses ByteRover (\`brv\`) as its long-term structured memory.
0.  **Initialization** Make sure spawn brv daemon started by \`brv\` command in the \`~/.openclaw\` workspace. If "brv" already started, DON'T start again.
1.  **Start:** Before answering complex questions, run \`cd ~/.openclaw && brv query "<topic>"\` to load existing patterns.
2.  **Finish:** After completing a task, run \`cd ~/.openclaw && brv curate "<summary>"\` to save knowledge.
3.  **Don't Guess:** If you don't know the project style, query it first.
4.  **Response Format:** When using knowledge, optionally cite it or mention storage:
    - "Based on brv contexts at \`~/.openclaw/.brv/context-trees/...\` and my research..."
    - "I also stored successfully knowledge to brv context-tree."
EOF
        echo -e "${GREEN}[✓] Updated AGENTS.md${NC}"
    else
        echo "AGENTS.md already contains Knowledge Protocol."
    fi
else
    echo -e "${YELLOW}Warning: AGENTS.md not found in workspace ($AGENT_WORKSPACE).${NC}"
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
        echo -e "${GREEN}[✓] Updated TOOLS.md${NC}"
    else
        echo "TOOLS.md already contains Tool Reference."
    fi
else
    echo -e "${YELLOW}Warning: TOOLS.md not found in workspace ($AGENT_WORKSPACE).${NC}"
fi

echo ""
echo -e "${GREEN}=== Installation Complete ===${NC}"
echo "Your agent is now integrated with ByteRover."