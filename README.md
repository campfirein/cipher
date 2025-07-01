# Overview

*`cipher`* is a simple, composable framework to build memory for agents using [Model Context Protocol](https://modelcontextprotocol.io/introduction).

**Design Principal**:
`cipher` bring the fundamental and best practices for building agent's memory:

1. It handles the complexity of MCP server connection's lifecycle so you don't have to
2. It implements the best practices for layered memories which helps your agents learning the data you already have. the memory layers improves with every run - rquiring zero changes in your agent's implementation and zero human guidance.
3. The memory aligns closely with the congnitive structure of the human minds, offering robust and realtime tuning.
4. It implements the reflections mechanism; this is not just the way to diagnose the issues with your agent, they're valuable data for agent can learn from.

Altogether, `cipher` is the simplest and easiest way to build memory for agents using MCP that helps your agents to remember and learn from the previous actions.

Much like MCP. this project is in early development.

We welcome all kinds of [contributions](/CONTRIBUTING.md), feedbacks, and suggestions to help us improve this project.

## Get Started

```bash
# build from source
pnpm i && pnpm run build && npm link
```

## Run Modes

Cipher supports two operational modes to fit different usage patterns:

### CLI Mode (Interactive)

The default mode provides an interactive command-line interface for direct conversation with your memory-powered agent:

```bash
# Run in interactive CLI mode (default)
cipher
# or explicitly specify CLI mode
cipher --mode cli
```

**Features:**

- Real-time conversation with the agent
- Persistent memory throughout the session
- Memory learning from every interaction
- Graceful exit with `exit` or `quit` commands
- Signal handling (Ctrl+C) for clean shutdown

### MCP Server Mode

Runs cipher as a Model Context Protocol server, allowing other MCP-compatible tools to connect and utilize the agent's memory capabilities:

```bash
# Run as MCP server
cipher --mode mcp
```

**Features:**

- Exposes agent capabilities via MCP protocol
- Enables integration with other MCP-compatible tools
- Persistent memory across client connections
- *Note: This mode is currently in development*

### Prerequisites

Before running cipher in any mode, ensure you have:

1. **Environment Configuration**: Copy `.env.example` to `.env` and configure at least one API provider:

   ```bash
   cp .env.example .env
   # Edit .env and add your API keys
   ```

2. **API Keys**: Set at least one of these in your `.env` file:
   - `OPENAI_API_KEY` for OpenAI models
   - `ANTHROPIC_API_KEY` for Anthropic Claude models

3. **Agent Configuration**: The agent uses `memAgent/cipher.yml` for configuration (included in the project)

### Additional Options

```bash
# Disable verbose output
cipher --no-verbose

# Show version
cipher --version

# Show help
cipher --help
```

## Configuration

Cipher uses a YAML configuration file (`memAgent/cipher.yml`) and environment variables for setup. The configuration is validated using strict schemas to ensure reliability.

### Configuration File Structure

The main configuration file is located at `memAgent/cipher.yml` and follows this structure:

```yaml
# LLM Configuration (Required)
llm:
  provider: openai                   # Required: 'openai' or 'anthropic'
  model: gpt-4.1-mini                # Required: Model name for the provider
  apiKey: $OPENAI_API_KEY            # Required: API key (supports env vars with $VAR syntax)
  maxIterations: 50                  # Optional: Max iterations for agentic loops (default: 50)
  baseURL: https://api.openai.com/v1 # Optional: Custom API base URL (OpenAI only)

# System Prompt (Required)
systemPrompt: "You are a helpful AI assistant with memory capabilities."

# MCP Servers Configuration (Optional)
mcpServers:
  filesystem:                        # Server name (can be any identifier)
    type: stdio                      # Connection type: 'stdio', 'sse', or 'http'
    command: npx                     # Command to launch the server
    args:                           # Arguments for the command
      - -y
      - "@modelcontextprotocol/server-filesystem" 
      - .
    env:                            # Environment variables for the server
      HOME: /Users/username
    timeout: 30000                  # Connection timeout in ms (default: 30000)
    connectionMode: lenient         # 'strict' or 'lenient' (default: lenient)

# Session Management (Optional)
sessions:
  maxSessions: 100                  # Maximum concurrent sessions (default: 100)
  sessionTTL: 3600000              # Session TTL in milliseconds (default: 1 hour)

# Agent Card (Optional) - for MCP server mode
agentCard:
  name: cipher                      # Agent name (default: cipher)
  description: "Custom description" # Agent description
  version: "1.0.0"                 # Version (default: 1.0.0)
  provider:
    organization: your-org          # Organization name
    url: https://your-site.com      # Organization URL
```

### Environment Variables

Create a `.env` file in the project root for sensitive configuration:

```bash
# API Keys (at least one required)
OPENAI_API_KEY=your_openai_api_key_here
ANTHROPIC_API_KEY=your_anthropic_api_key_here

# API Configuration (optional)
OPENAI_BASE_URL=https://api.openai.com/v1

# Logger Configuration (optional)
CIPHER_LOG_LEVEL=info             # debug, info, warn, error
REDACT_SECRETS=true               # true/false - redact sensitive info in logs
```

### LLM Provider Configuration

#### OpenAI

```yaml
llm:
  provider: openai
  model: gpt-4.1                     # or o4-mini, etc.
  apiKey: $OPENAI_API_KEY
  baseURL: https://api.openai.com/v1  # Optional: for custom endpoints
```

#### Anthropic Claude

```yaml
llm:
  provider: anthropic
  model: claude-4-sonnet-20250514    # or claude-3-7-sonnet-20250219, etc.
  apiKey: $ANTHROPIC_API_KEY
```

### MCP Server Types

#### Stdio Servers (Local Processes)

```yaml
mcpServers:
  myserver:
    type: stdio
    command: node                  # or python, uvx, etc.
    args: ["server.js", "--port=3000"]
    env:
      API_KEY: $MY_API_KEY
    timeout: 30000
    connectionMode: lenient
```

#### SSE Servers (Server-Sent Events)

```yaml
mcpServers:
  sse_server:
    type: sse
    url: https://api.example.com/sse
    headers:
      Authorization: "Bearer $TOKEN"
    timeout: 30000
    connectionMode: strict
```

#### HTTP Servers (REST APIs)

```yaml
mcpServers:
  http_server:
    type: http
    url: https://api.example.com
    headers:
      Authorization: "Bearer $TOKEN"
      User-Agent: "Cipher/1.0"
    timeout: 30000
    connectionMode: lenient
```

### Configuration Validation

Cipher validates all configuration at startup:

- **LLM Provider**: Must be 'openai' or 'anthropic'
- **API Keys**: Must be non-empty strings
- **URLs**: Must be valid URLs when provided
- **Numbers**: Must be positive integers where specified
- **MCP Server Types**: Must be 'stdio', 'sse', or 'http'

### Environment Variable Expansion

You can use environment variables anywhere in the YAML configuration:

```yaml
llm:
  apiKey: $OPENAI_API_KEY          # Simple expansion
  baseURL: ${API_BASE_URL}         # Brace syntax
  model: ${MODEL_NAME:-gpt-4}      # With default value (syntax may vary)
```

### Configuration Loading

1. Cipher looks for `memAgent/cipher.yml` in the current directory
2. Environment variables are loaded from `.env` if present
3. Configuration is parsed, validated, and environment variables are expanded

## Capabilities

**MCP integration**: cipher handles all the complexity of MCP connections
**Dual layers Memory**: cipher leverages two layers of memory: knowledge base && 
refelection

## LLM Providers

Cipher currently supports multiple LLLM providers:

- **OpenAI**: `gpt-4.1-mini`, `gpt-4.1`, `o4-mini`, `o3`
**Anthropic**: `claude-4-sonnet-20250514`, `claude-3-7-sonnet-20250219`

## Contributing

We welcome contributions! Refer to our [Contributing Guide](./CONTRIBUTING.md) for more details.

## Community & Support

Join our [Discord](https://discord.com/invite/UMRrpNjh5W) to chat with the community and get support.

If you're enjoying this project, please give us a ⭐ on GitHub!

## License

[Apache License 2.0](LICENSE)

## Chat Simulation and Vector Storage

This project includes a CLI tool to simulate a chat between a user and Cursor (powered by OpenAI), and store each user query and AI response as vector embeddings for semantic search.

### Usage

1. Set your OpenAI API key in the environment:

```sh
export OPENAI_API_KEY=sk-...
```

2. (Optional) Configure embedding model, storage path, and retry count:

```sh
export EMBEDDING_MODEL=text-embedding-ada-002
export CHAT_MEMORY_PATH=memAgent/chat_memory.json
export EMBEDDING_RETRY=3
```

3. Run the chat simulation CLI:

```sh
pnpm tsx src/core/brain/memAgent/simulate-chat.ts
```

You will be prompted for a user purpose (e.g., "write a binary search tree"). The tool will generate a response using OpenAI, compute embeddings for both the input and response, and store the result in the configured storage file.

### Storage Format

Each chat interaction is stored as a JSON object with the following fields:

- `userPurpose`: The user's input string
- `cursorResponse`: The AI-generated response
- `userEmbedding`: Vector embedding for the user input
- `responseEmbedding`: Vector embedding for the response
- `timestamp`: ISO timestamp

### Configuration

- `OPENAI_API_KEY`: Your OpenAI API key (required)
- `EMBEDDING_MODEL`: Embedding model to use (default: `text-embedding-ada-002`)
- `CHAT_MEMORY_PATH`: File path for storing chat memory (default: `memAgent/chat_memory.json`)
- `EMBEDDING_RETRY`: Number of retries for embedding generation and file write (default: 3)

## MemAgent Automatic Chat & Embedding Storage

MemAgent now automatically saves every user input, agent response, and their vector embeddings after each interaction.

- **What is stored:**
  - User input (prompt)
  - Agent response
  - Embeddings for both
  - Timestamp
  - Session ID (if available)
- **Where:**
  - By default, in `memAgent/chat_memory.json` (configurable via `CHAT_MEMORY_PATH` environment variable)
- **How:**
  - Storage is asynchronous and does not block the agent's main flow.
  - Embeddings are generated using OpenAI (model configurable via `EMBEDDING_MODEL`).
- **Configuration:**
  - `CHAT_MEMORY_PATH`, `EMBEDDING_MODEL`, and `EMBEDDING_RETRY` can be set as environment variables.

This enables semantic search and long-term memory for all agent interactions.

## MemAgent Demo: End-to-End Chat + Embedding Storage

You can run a demo to verify that MemAgent automatically saves user input, agent response, and their embeddings after each interaction.

### 1. Set Up
- Ensure dependencies are installed: `npm install` or `pnpm install`
- Set your OpenAI API key:
  ```sh
  export OPENAI_API_KEY=sk-...   # Use your real key
  ```

### 2. Run the Demo
- Execute the demo script:
  ```sh
  npx tsx src/core/brain/memAgent/demo-agent.ts
  ```
- You can change the model in the script (e.g., `gpt-4o-mini`, `gpt-3.5-turbo`, etc.)

### 3. What to Expect
- The agent's response will be printed in the terminal.
- The last entry in `memAgent/chat_memory.json` will be printed, showing:
  - Your prompt
  - The agent's response
  - Embeddings for both
  - Timestamp
  - Session ID

This demonstrates the full workflow: MemAgent receives input, generates a response, and persists the interaction and embeddings for semantic memory.
