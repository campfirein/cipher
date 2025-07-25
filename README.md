# Cipher

<div align="center">

<img src="./assets/cipher-logo.png" alt="Cipher Agent Logo" width="400" />

<p align="center">
<em>Memory-powered AI agent framework with MCP integration</em>
</p>

<p align="center">
<a href="LICENSE"><img src="https://img.shields.io/badge/License-Elastic%202.0-blue.svg" alt="License" /></a>
<img src="https://img.shields.io/badge/Status-Beta-orange.svg" alt="Beta" />
<a href="https://docs.byterover.dev/cipher/overview"><img src="https://img.shields.io/badge/Docs-Documentation-green.svg" alt="Documentation" /></a>
<a href="https://discord.com/invite/UMRrpNjh5W"><img src="https://img.shields.io/badge/Discord-Join%20Community-7289da" alt="Discord" /></a>
</p>

</div>

## Overview

Cipher is an opensource memory layer specifically designed for coding agents. Compatible with **Cursor, Windsurf, Claude Desktop, Claude Code, Gemini CLI, AWS's Kiro, VS Code, and Roo Code** through MCP, and coding agents, such as **Kimi K2**. (see more on [examples](./examples))

**Key Features:**

- ⁠MCP integration with any IDE you want.
- ⁠Auto-generate AI coding memories that scale with your codebase.
- ⁠Switch seamlessly between IDEs without losing memory and context.
- ⁠Easily share coding memories across your dev team in real time.
- ⁠Dual Memory Layer that captures System 1 (Programming Concepts & Business Logic & Past Interaction) and System 2 (reasoning steps of the model when generating code).
- ⁠Install on your IDE with zero configuration needed.

## Quick Start

### NPM Package (Recommended for Most Users)

```bash
# Install globally
npm install -g @byterover/cipher

# Or install locally in your project
npm install @byterover/cipher
```

### Docker

```bash
# Clone and setup
git clone https://github.com/campfirein/cipher.git
cd cipher

# Configure environment
cp .env.example .env
# Edit .env with your API keys

# Start with Docker
docker-compose up -d

# Test
curl http://localhost:3000/health
```

### From Source

```bash
pnpm i && pnpm run build && npm link
```

### CLI Usage

```bash
# Interactive mode
cipher

# One-shot command
cipher "Add this to memory as common causes of 'CORS error' in local dev with Vite + Express."

# API server mode
cipher --mode api

# MCP server mode
cipher --mode mcp
```

## Configuration

Configure Cipher using environment variables and YAML config:

### Environment Variables (.env)

```bash
# Required: At least one API key
OPENAI_API_KEY=your_openai_api_key          # Recommended for LLM + embeddings
ANTHROPIC_API_KEY=your_anthropic_api_key    # Alternative LLM provider
OPENROUTER_API_KEY=your_openrouter_api_key  # Alternative LLM provider
GEMINI_API_KEY=your_gemini_api_key         # Free embeddings alternative

# Ollama (self-hosted, no API key needed)
OLLAMA_BASE_URL=http://localhost:11434/v1

# Embedding configuration (optional)
DISABLE_EMBEDDINGS=false                    # Set to true to disable embeddings entirely

# Optional
CIPHER_LOG_LEVEL=info
NODE_ENV=production
```

### Agent Configuration (memAgent/cipher.yml)

```yaml
# LLM Configuration
llm:
  provider: openai # openai, anthropic, openrouter, ollama, qwen
  model: gpt-4-turbo
  apiKey: $OPENAI_API_KEY

# System Prompt
systemPrompt: 'You are a helpful AI assistant with memory capabilities.'

# MCP Servers (optional)
mcpServers:
  filesystem:
    type: stdio
    command: npx
    args: ['-y', '@modelcontextprotocol/server-filesystem', '.']
```

## Capabilities

- **Multiple Operation Modes**: CLI interactive, one-shot commands, REST API server, MCP server
- **Session Management**: Create, switch, and manage multiple conversation sessions
- **Memory Integration**: Persistent memory that learns from every interaction
- **MCP Protocol Support**: Full Model Context Protocol integration for tools and resources
- **Multi-LLM Support**: OpenAI, Anthropic, OpenRouter, Ollama, and Alibaba Cloud Qwen compatibility
- **Knowledge Graph**: Structured memory with entity relationships (Neo4j, in-memory)
- **Real-time Learning**: Memory layers that improve automatically with usage

## Embedding Providers

Cipher supports multiple embedding providers with OpenAI as the default choice for reliability and consistency. Other providers can be configured via YAML for specific needs:

### Configuration Priority

1. **YAML Configuration** (highest priority) - `embedding:` section in `cipher.yml`
2. **Environment Auto-detection** (fallback) - Based on available API keys

### Environment Priority Order (when no YAML config)

1. **OpenAI** (default, reliable) - `OPENAI_API_KEY=your_key`
2. **Gemini** (free alternative) - `GEMINI_API_KEY=your_key`
3. **Ollama** (self-hosted) - `OLLAMA_BASE_URL=http://localhost:11434`
4. **Disabled mode** - `DISABLE_EMBEDDINGS=true`

### YAML Configuration (Recommended for Alternative Providers)

**For users who prefer free or local alternatives to OpenAI**, configure embeddings explicitly in `cipher.yml`:

```yaml
# OpenAI (default, reliable)
embedding:
  type: openai
  model: text-embedding-3-small
  apiKey: $OPENAI_API_KEY

# Gemini (free alternative)
embedding:
  type: gemini
  model: gemini-embedding-001
  apiKey: $GEMINI_API_KEY

# Ollama (self-hosted)
embedding:
  type: ollama
  model: mxbai-embed-large
  baseUrl: $OLLAMA_BASE_URL

# Disable embeddings
embedding:
  disabled: true
```

### Environment-Only Setup (Simple)

```bash
# Option 1: OpenAI embeddings (default, reliable)
OPENAI_API_KEY=your_openai_key

# Option 2: Free Gemini embeddings
GEMINI_API_KEY=your_gemini_key

# Option 3: Self-hosted Ollama embeddings
OLLAMA_BASE_URL=http://localhost:11434

# Option 4: Disable embeddings (lightweight mode)
DISABLE_EMBEDDINGS=true
```

### Setting up Ollama (Self-hosted)

To use Ollama for local embeddings:

1. **Install Ollama**:

   ```bash
   # macOS
   brew install ollama

   # Or download from https://ollama.ai
   ```

2. **Start Ollama service**:

   ```bash
   ollama serve
   ```

3. **Pull embedding model**:

   ```bash
   # Recommended embedding model
   ollama pull nomic-embed-text

   # Alternative models
   ollama pull all-minilm
   ollama pull mxbai-embed-large
   ```

4. **Configure in YAML**:

   ```yaml
   embedding:
     type: ollama
     model: mxbai-embed-large # or your chosen model
     baseUrl: $OLLAMA_BASE_URL
   ```

5. **Set environment**:

   ```bash
   OLLAMA_BASE_URL=http://localhost:11434
   ```

6. **Test connection**:
   ```bash
   cipher "🧪 Testing Ollama: What is machine learning?"
   ```

## LLM Providers

Cipher supports multiple LLM providers:

### OpenAI

```yaml
llm:
  provider: openai
  model: gpt-4-turbo
  apiKey: $OPENAI_API_KEY
```

### Anthropic Claude

```yaml
llm:
  provider: anthropic
  model: claude-3-5-sonnet-20241022
  apiKey: $ANTHROPIC_API_KEY
```

### OpenRouter (200+ Models)

```yaml
llm:
  provider: openrouter
  model: openai/gpt-4-turbo # Any OpenRouter model
  apiKey: $OPENROUTER_API_KEY
```

### Ollama (Self-Hosted, No API Key)

```yaml
llm:
  provider: ollama
  model: qwen2.5:32b # Recommended for best performance
  baseURL: $OLLAMA_BASE_URL
```

### Alibaba Cloud Qwen

```yaml
llm:
  provider: qwen
  model: qwen2.5-72b-instruct
  apiKey: $QWEN_API_KEY
  qwenOptions:
    enableThinking: true # Enable Qwen's thinking mode
    thinkingBudget: 1000 # Thinking budget for complex reasoning
```

## AWS Bedrock (Amazon Bedrock)

```yaml
llm:
  provider: aws
  model: meta.llama3-1-70b-instruct-v1:0 # Or another Bedrock-supported model
  maxIterations: 50
  aws:
    region: $AWS_REGION
    accessKeyId: $AWS_ACCESS_KEY_ID
    secretAccessKey: $AWS_SECRET_ACCESS_KEY
    # sessionToken: $AWS_SESSION_TOKEN   # (uncomment if needed)
```

> **Required environment variables:**
>
> - `AWS_REGION`
> - `AWS_ACCESS_KEY_ID`
> - `AWS_SECRET_ACCESS_KEY`
> - `AWS_SESSION_TOKEN` (optional, for temporary credentials)

## Azure OpenAI

```yaml
llm:
  provider: azure
  model: gpt-4o-mini # Or your Azure deployment/model name
  apiKey: $AZURE_OPENAI_API_KEY
  maxIterations: 50
  azure:
    endpoint: $AZURE_OPENAI_ENDPOINT
    deploymentName: gpt-4o-mini # Optional, defaults to model name
```

> **Required environment variables:**
>
> - `AZURE_OPENAI_API_KEY`
> - `AZURE_OPENAI_ENDPOINT`

## CLI Reference

```bash
# Basic usage
cipher                              # Interactive CLI mode
cipher "Your prompt here"           # One-shot mode

# Server modes
cipher --mode api                   # REST API server
cipher --mode mcp                   # MCP server

# Configuration
cipher --agent /path/to/config.yml  # Custom config
cipher --strict                     # Strict MCP connections
cipher --new-session [id]           # Start with new session

# CLI commands
/session list                       # List sessions
/session new [id]                   # Create session
/session switch <id>                # Switch session
/config                             # Show config
/stats                              # Show statistics
/help                               # Show help
```

## MCP Server Usage

Cipher can run as an MCP (Model Context Protocol) server, allowing integration with MCP-compatible clients like Claude Desktop, Cursor, Windsurf, and other AI coding assistants.

### Quick Setup

To use Cipher as an MCP server in your MCP client configuration:

```json
{
	"mcpServers": {
		"cipher": {
			"type": "stdio",
			"command": "cipher",
			"args": ["--mode", "mcp"],
			"env": {
				"OPENAI_API_KEY": "your_openai_api_key",
				"ANTHROPIC_API_KEY": "your_anthropic_api_key"
			}
		}
	}
}
```

### Example Configurations

#### Claude Desktop Configuration

Add to your Claude Desktop MCP configuration file:

```json
{
	"mcpServers": {
		"cipher": {
			"type": "stdio",
			"command": "cipher",
			"args": ["--mode", "mcp"],
			"env": {
				"OPENAI_API_KEY": "sk-your-openai-key",
				"ANTHROPIC_API_KEY": "sk-ant-your-anthropic-key"
			}
		}
	}
}
```

### Environment Variables

The MCP server requires at least one LLM provider API key:

```bash
# Required (at least one)
OPENAI_API_KEY=your_openai_api_key      # Always required for embedding
ANTHROPIC_API_KEY=your_anthropic_api_key
OPENROUTER_API_KEY=your_openrouter_api_key
QWEN_API_KEY=your-alibaba_cloud_api_key
# Optional
OLLAMA_BASE_URL=http://localhost:11434/v1
DISABLE_EMBEDDINGS=false                    # Set to true to disable embeddings
CIPHER_LOG_LEVEL=info
NODE_ENV=production
```

### MCP Aggregator Mode

Cipher now supports a new **MCP Aggregator Mode** that exposes all available tools (not just `ask_cipher`) to MCP clients, including all built-in tools for cipher, such as `cipher_search_memory` and MCP server tools specified in `cipher.yml`. This is controlled by the `MCP_SERVER_MODE` environment variable.

#### Modes

- **default**: Only the `ask_cipher` tool is available.
- **aggregator**: All tools (including those from connected MCP servers) are available, with conflict resolution and timeout options.

#### Environment Variables

```bash
# Select MCP server mode: 'default' (only ask_cipher) or 'aggregator' (all tools)
MCP_SERVER_MODE=aggregator

# (Optional) Tool name conflict resolution: 'prefix' (default), 'first-wins', or 'error'
AGGREGATOR_CONFLICT_RESOLUTION=prefix

# (Optional) Tool execution timeout in milliseconds (default: 60000)
AGGREGATOR_TIMEOUT=60000
```

#### Example MCP Aggregator JSON Config

```json
{
	"mcpServers": {
		"cipher-aggregator": {
			"type": "stdio",
			"command": "cipher",
			"args": ["--mode", "mcp"],
			"env": {
				"OPENAI_API_KEY": "sk-your-openai-key",
				"MCP_SERVER_MODE": "aggregator",
				"AGGREGATOR_CONFLICT_RESOLUTION": "prefix",
				"AGGREGATOR_TIMEOUT": "60000"
			}
		}
	}
}
```

- In **aggregator** mode, all tools are exposed. Tool name conflicts are resolved according to `AGGREGATOR_CONFLICT_RESOLUTION`.
- If you want only the `ask_cipher` tool, set `MCP_SERVER_MODE=default` or omit the variable.

Check out the [MCP Aggregator Hub example](./examples/04-mcp-aggregator-hub/) that further demonstrates the usecase of this MCP server mode.

---

### SSE Transport Support

Cipher now supports **SSE (Server-Sent Events)** as a transport for MCP server mode, in addition to `stdio` and `http`.

#### CLI Usage

To start Cipher in MCP mode with SSE transport:

```bash
cipher --mode mcp --mcp-transport-type sse --mcp-port 4000
```

- `--mcp-transport-type sse` enables SSE transport.
- `--mcp-port 4000` sets the port (default: 3000).

#### Example MCP Client Config for SSE

```json
{
	"mcpServers": {
		"cipher-sse": {
			"type": "sse",
			"url": "http://localhost:4000/mcp",
			"env": {
				"OPENAI_API_KEY": "sk-your-openai-key"
			}
		}
	}
}
```

- Set `"type": "sse"` and provide the `"url"` to the running Cipher SSE server.

---

## Use Case: Claude Code with Cipher MCP

Cipher integrates seamlessly with Claude Code through MCP, providing persistent memory that enhances your coding experience. Here's how it works:

### Memory Storage

<img src="./assets/cipher_store_memory.png" alt="Cipher storing conversation context" />

Every interaction with Claude Code can be automatically stored in Cipher's dual memory system, capturing both programming concepts and reasoning patterns to improve future assistance.

### Memory Retrieval

<img src="./assets/cipher_retrieve_memory.png" alt="Cipher retrieving previous conversation context" />

When you ask Claude Code to recall previous conversations, Cipher's memory layer instantly retrieves relevant context, allowing you to continue where you left off without losing important details.

---

### 🚀 Demo Video: Claude Code + Cipher MCP Server

<a href="https://drive.google.com/file/d/1az9t9jFOHAhRN21VMnuHPybRYwA0q0aF/view?usp=drive_link" target="_blank">
  <img src="assets/demo_claude_code.png" alt="Watch the demo" width="60%" />
</a>

> **Click the image above to watch a short demo of Claude Code using Cipher as an MCP server.**

For detailed configuration instructions, see the [CLI Coding Agents guide](./examples/02-cli-coding-agents/README.md).

## Next Steps

For detailed documentation, visit:

- [Quick Start Guide](https://docs.byterover.dev/cipher/quickstart)
- [Configuration Guide](https://docs.byterover.dev/cipher/configuration)
- [Complete Documentation](https://docs.byterover.dev/cipher/overview)

## Contributing

We welcome contributions! Refer to our [Contributing Guide](./CONTRIBUTING.md) for more details.

## Community & Support

**cipher** is the opensource version of the agentic memory of [byterover](https://byterover.dev/) which is built and maintained by the byterover team.

- Join our [Discord](https://discord.com/invite/UMRrpNjh5W) to share projects, ask questions, or just say hi!
- If you enjoy cipher, please give us a ⭐ on GitHub—it helps a lot!
- Follow [@kevinnguyendn](https://x.com/kevinnguyendn) on X

## Contributors

Thanks to all these amazing people for contributing to cipher!

[Contributors](https://github.com/campfirein/cipher/graphs/contributors)

## Star History

<a href="https://star-history.com/#campfirein/cipher&Date">
  <img width="500" alt="Star History Chart" src="https://api.star-history.com/svg?repos=campfirein/cipher&type=Date&v=2">
</a>

## License

Elastic License 2.0. See [LICENSE](LICENSE) for full terms.

## Text Normalization for Embeddings

To improve semantic search quality, text is normalized before embedding and storage. Normalization includes:
- Lowercasing
- Punctuation removal
- Whitespace normalization
- Optional: Stopwords removal, stemming, lemmatization

Configure via refinement_config.json. For backward compatibility, existing data may need re-embedding.
