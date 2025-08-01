# MCP Aggregator Hub

> 🔗 **Comprehensive MCP server aggregator for seamless IDE integration with enhanced tools**

## Key Benefits of Aggregator Mode

- **Single Integration Point**: Connect to multiple MCP servers through one Cipher instance
- **Memory-Enhanced**: Persistent cross-session learning and context retention
- **Transport Flexibility**: Supports stdio, SSE, and streamable-http connections seamlessly
- **IDE Compatibility**: Works with Cursor, Claude Code, VS Code, and other MCP-compatible editors

## MCP Servers Overview

### 🔍 **Exa Search** - Advanced Web Research
- **Purpose**: Comprehensive web search, competitor analysis, and real-time information
- **GitHub**: [exa-labs/exa-mcp-server](https://github.com/exa-labs/exa-mcp-server)
- **Setup**: Get API key from [dashboard.exa.ai/api-keys](https://dashboard.exa.ai/api-keys)
- **Transport**: `stdio` (local npx execution)
- **Tools**: web_search_exa, research_paper_search, company_research, competitor_finder, linkedin_search, wikipedia_search, github_search, deep_researcher_start, deep_researcher_check

### 📚 **Context7** - Live Documentation Access  
- **Purpose**: Up-to-date framework documentation and API references
- **GitHub**: [upstash/context7](https://github.com/upstash/context7)
- **Setup**: No API key required (free service)
- **Transport**: `streamable-http` via `https://mcp.context7.com/mcp`
- **Tools**: resolve-library-id, get-library-docs

### 🔒 **Semgrep** - Security Vulnerability Scanning
- **Purpose**: Code security analysis and vulnerability detection
- **GitHub**: [semgrep/mcp](https://github.com/semgrep/mcp)
- **Setup**: No API key required for basic scanning
- **Transport**: `streamable-http` via `https://mcp.semgrep.ai/mcp/`
- **Tools**: semgrep_rule_schema, get_supported_languages, semgrep_scan_with_custom_rule, semgrep_scan, security_check, get_abstract_syntax_tree

### 📋 **TaskMaster** - AI-Powered Task Management
- **Purpose**: Structured project planning and development workflow management
- **GitHub**: [eyaltoledano/claude-task-master](https://github.com/eyaltoledano/claude-task-master)
- **Setup**: Requires OpenAI or Anthropic API key
- **Transport**: `stdio` (local npx execution)
- **Status**: **Disabled by default** - TaskMaster provides 30+ tools which consume significant context window space. Enable if needed for advanced project management.
- **Claude Code Setup**: For users interested in TaskMaster with Claude Code, see [this setup guide](https://github.com/eyaltoledano/claude-task-master/blob/main/docs/examples/claude-code-usage.md) which requires no API key configuration.

## Adding Custom MCP Servers

To extend the aggregator with your own MCP servers, add them to the `mcpServers` section in `cipher.yml`. Cipher supports all three MCP transport types:

### **Transport Type: `stdio`** (Local Process)
```yaml
your-server:
  type: stdio                    # Required: Transport type
  command: npx                   # Required: Command to execute
  args:                          # Required: Command arguments
    - -y
    - "your-mcp-server"
  env:                           # Optional: Environment variables
    API_KEY: $YOUR_API_KEY
  enabled: true                  # Optional: Enable/disable (default: true)
  timeout: 30000                 # Optional: Connection timeout in ms (default: 30000)
  connectionMode: lenient        # Optional: 'strict' or 'lenient' (default: 'lenient')
```

### **Transport Type: `streamable-http`** (Remote HTTP Server)
```yaml
your-remote-server:
  type: "streamable-http"        # Required: Transport type
  url: "https://api.example.com/mcp" # Required: Server URL
  headers:                       # Optional: HTTP headers
    Authorization: "Bearer token"
    User-Agent: "MyApp/1.0"
  enabled: true                  # Optional: Enable/disable (default: true)
  timeout: 30000                 # Optional: Connection timeout in ms (default: 30000)
  connectionMode: lenient        # Optional: 'strict' or 'lenient' (default: 'lenient')
```

### **Transport Type: `sse`** (Server-Sent Events)
```yaml
your-sse-server:
  type: "sse"                    # Required: Transport type
  url: "https://api.example.com/sse" # Required: SSE endpoint URL
  headers:                       # Optional: HTTP headers
    Authorization: "Bearer token"
  enabled: true                  # Optional: Enable/disable (default: true)
  timeout: 30000                 # Optional: Connection timeout in ms (default: 30000)
  connectionMode: lenient        # Optional: 'strict' or 'lenient' (default: 'lenient')
```

### **Configuration Fields Reference**

**Required Fields:**
- `type`: Transport protocol (`stdio`, `streamable-http`, or `sse`)
- For `stdio`: `command` and `args`
- For `streamable-http`/`sse`: `url`

**Optional Fields:**
- `enabled`: Enable/disable server (default: `true`)
- `timeout`: Connection timeout in milliseconds (default: `30000`)
- `connectionMode`: Error handling mode
  - `lenient` (default): Log failures but continue with other servers
  - `strict`: Stop initialization if this server fails
- `env`: Environment variables (stdio only)
- `headers`: HTTP headers (streamable-http/sse only)

**Connection Modes:**
- **Lenient mode**: If a server fails to connect, it's logged as a warning but other servers continue to work
- **Strict mode**: If a server fails to connect, the entire aggregator initialization fails

## Configuration Example

Add Cipher aggregator to your MCP client configuration:

```json
{
  "mcpServers": {
    "cipher": {
      "command": "/path/to/cipher/dist/src/app/index.cjs",
      "args": [
        "--mode",
        "mcp", 
        "--agent",
        "/path/to/cipher/examples/04-mcp-aggregator-hub/cipher.yml"
      ],
      "env": {
        "MCP_SERVER_MODE": "aggregator",
        "AGGREGATOR_TIMEOUT": "60000",
        "AGGREGATOR_CONFLICT_RESOLUTION": "prefix",
        "OPENAI_API_KEY": "your_openai_api_key",
        "EXA_API_KEY": "your_exa_api_key",
        ...
      }
    }
  }
}
```

**Required Environment Variables:**
- `OPENAI_API_KEY`: For LLM and embeddings
- `EXA_API_KEY`: For web search functionality
- Vector store configuration for memory persistence

**Current Configuration (`cipher.yml`):**
```yaml
# LLM Configuration
llm:
  provider: openai
  model: gpt-4o-mini
  apiKey: $OPENAI_API_KEY

mcpServers:
  # Exa Search (stdio transport)
  exa:
    type: stdio
    command: npx
    args: ["-y", "exa-mcp-server"]
    env:
      EXA_API_KEY: $EXA_API_KEY

  # Context7 (streamable-http transport)  
  context7:
    type: "streamable-http"
    url: "https://mcp.context7.com/mcp"
    enabled: true

  # Semgrep (streamable-http transport)
  semgrep:
    type: "streamable-http" 
    url: "https://mcp.semgrep.ai/mcp/"
    enabled: true

  # TaskMaster (disabled by default)
  taskmaster:
    type: stdio
    command: npx
    args: ["-y", "--package=task-master-ai", "task-master-ai"]
    enabled: false
    env:
      OPENAI_API_KEY: $OPENAI_API_KEY
```

## Quick Start

Use the configuration example above with your specific paths and API keys. All required environment variables are defined directly in the MCP client configuration.

**Available Transport Types**: The aggregator seamlessly supports all three MCP transport protocols (stdio, sse, streamable-http) allowing you to mix local and remote MCP servers in a single unified interface.
