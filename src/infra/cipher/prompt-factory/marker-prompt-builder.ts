/**
 * Simple marker-based prompt builder.
 *
 * Generates additional prompt sections based on available tool markers,
 * without requiring full template/config infrastructure.
 */

/**
 * Build additional prompt sections based on available tool markers.
 *
 * @param availableMarkers - Set of tool marker strings from registered tools
 * @param availableTools - Array of tool names
 * @returns Additional prompt text to append to base system prompt
 */
export function buildMarkerBasedPromptSections(
  availableMarkers: Set<string>,
  availableTools: string[],
): string {
  const sections: string[] = []

  // Core capabilities section
  if (availableMarkers.has('ToolMarkerCore')) {
    sections.push(`
## Core Capabilities

You have access to essential file system tools for understanding codebases:`)

    if (availableTools.includes('read_file')) {
      sections.push(`- **read_file**: Read file contents with pagination support (offset/limit)`)
    }

    if (availableTools.includes('glob_files')) {
      sections.push(`- **glob_files**: Find files using glob patterns (supports ** for recursive search)`)
    }

    if (availableTools.includes('grep_content')) {
      sections.push(`- **grep_content**: Search file contents using regex patterns with context lines`)
    }
  }

  // Discovery strategy section
  if (availableMarkers.has('ToolMarkerDiscovery')) {
    sections.push(`
## Codebase Exploration Strategy

When exploring a new codebase:
1. **Discover structure** - Use glob_files to identify file organization patterns
2. **Search for patterns** - Use grep_content to find specific code, functions, or imports
3. **Read key files** - Use read_file to examine discovered files
4. **Build mental model** - Progressively understand the codebase architecture

Tip: Start with glob patterns like "**/*.ts", "**/*.json", then narrow down based on findings.`)
  }

  // Context building section
  if (availableMarkers.has('ToolMarkerContextBuilding')) {
    sections.push(`
## Context Tree Building`)

    if (availableTools.includes('segment_conversation')) {
      sections.push(`
You can organize conversations into semantic episodes using **segment_conversation**.

**Critical workflow for context tree building**:
1. **Analyze conversation history** - Review all messages to understand context flow
2. **Identify episode boundaries** - Look for:
   - Time gaps between messages
   - Topic switches (e.g., setup → implementation → debugging)
   - Context changes (e.g., switching files or modules)
3. **Create episode structures** - Define id, title, and summary for each segment
4. **Validate with segment_conversation** - Tool validates your episode structure

**Example episodes**:
- Episode 1: "Project Setup" - Initialized repo, configured TypeScript
- Episode 2: "API Implementation" - Built REST endpoints, added validation
- Episode 3: "Bug Fixes" - Resolved authentication issues

This helps you maintain context across long conversations and build a semantic tree of project evolution.`)
    }

    if (availableTools.includes('search_history')) {
      sections.push(`
- **search_history**: Search past conversations to find relevant context`)
    }
  }

  // Modification capabilities section
  if (availableMarkers.has('ToolMarkerModification')) {
    sections.push(`
## File Modification

You can modify files using:`)

    if (availableTools.includes('write_file')) {
      sections.push(`- **write_file**: Create new files or completely overwrite existing ones`)
    }

    if (availableTools.includes('edit_file')) {
      sections.push(`- **edit_file**: Make precise edits by replacing text (requires unique match unless replaceAll=true)`)
    }

    sections.push(`
**Best Practice**: ALWAYS read files before editing to ensure accuracy and avoid errors.`)
  }

  // Execution capabilities section
  if (availableMarkers.has('ToolMarkerExecution')) {
    sections.push(`
## Command Execution`)

    if (availableTools.includes('bash_exec')) {
      sections.push(`
You can execute shell commands using **bash_exec**:
- Foreground execution: Wait for command to complete
- Background execution: Run long tasks asynchronously`)
    }

    if (availableTools.includes('bash_output')) {
      sections.push(`- **bash_output**: Retrieve output from background processes`)
    }

    if (availableTools.includes('kill_process')) {
      sections.push(`- **kill_process**: Terminate background processes (SIGTERM → SIGKILL escalation)`)
    }
  }

  return sections.length > 0 ? '\n' + sections.join('\n') : ''
}
