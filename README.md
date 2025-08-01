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

Built by [Byterover team](https://byterover.dev/)

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

## Embedding Configuration

Configure embeddings in `memAgent/cipher.yml`. If not specified, uses automatic fallback based on your LLM provider. Below is the table of fallback embedding models:

### Supported Providers

| Provider         | Config              | Fallback Model                 | Fixed Dimensions           |
| ---------------- | ------------------- | ------------------------------ | -------------------------- |
| **OpenAI**       | `type: openai`      | `text-embedding-3-small`       | No                         |
| **Gemini**       | `type: gemini`      | `gemini-embedding-001`         | No                         |
| **Qwen**         | `type: qwen`        | `text-embedding-v3`            | Yes (1024, 768, 512)       |
| **Voyage**       | `type: voyage`      | `voyage-3-large`               | Yes (1024, 256, 512, 2048) |
| **AWS Bedrock**  | `type: aws-bedrock` | `amazon.titan-embed-text-v2:0` | Yes (1024, 512, 256)       |
| **Azure OpenAI** | `type: openai`      | `text-embedding-3-small`       | No                         |
| **Ollama**       | `type: ollama`      | `nomic-embed-text`             | No                         |

### Configuration Examples

```yaml
# OpenAI
embedding:
  type: openai
  model: text-embedding-3-small
  apiKey: $OPENAI_API_KEY

# Qwen (fixed dimensions - must specify)
embedding:
  type: qwen
  model: text-embedding-v3
  apiKey: $QWEN_API_KEY
  dimensions: 1024  # Required: 1024, 768, or 512

# AWS Bedrock (fixed dimensions - must specify)
embedding:
  type: aws-bedrock
  model: amazon.titan-embed-text-v2:0
  region: $AWS_REGION
  accessKeyId: $AWS_ACCESS_KEY_ID
  secretAccessKey: $AWS_SECRET_ACCESS_KEY
  dimensions: 1024  # Required: 1024, 512, or 256

# Azure OpenAI
embedding:
  type: openai
  model: text-embedding-3-small
  apiKey: $AZURE_OPENAI_API_KEY
  baseUrl: $AZURE_OPENAI_ENDPOINT

# Voyage (fixed dimensions - must specify)
embedding:
  type: voyage
  model: voyage-3-large
  apiKey: $VOYAGE_API_KEY
  dimensions: 1024  # Required: 1024, 256, 512, or 2048

# LM Studio (local, no API key required)
embedding:
  type: lmstudio
  model: nomic-embed-text-v1.5  # or bge-large, bge-base, bge-small
  baseUrl: http://localhost:1234/v1  # Optional, defaults to this
  # dimensions: 768  # Optional, auto-detected based on model

# Disable embeddings (chat-only mode)
embedding:
  disabled: true
```

**Note:** Setting `embedding: disabled: true` disables all memory-related tools (`cipher_memory_search`, `cipher_extract_and_operate_memory`, etc.) and operates in chat-only mode.

### Automatic Fallback

If no embedding config is specified, automatically uses your LLM provider's embedding:

- **Anthropic LLM** → Voyage embedding (needs `VOYAGE_API_KEY`)
- **AWS LLM** → AWS Bedrock embedding (uses same credentials)
- **Azure LLM** → Azure OpenAI embedding (uses same endpoint)
- **Qwen LLM** → Qwen embedding (uses same API key)
- **LM Studio LLM** → LM Studio embedding (tries same model first, then dedicated embedding model, finally OpenAI)
- **Ollama LLM** → Ollama embedding (uses same local server)
- **OpenAI/Gemini/Ollama** → Same provider embedding

**Note:** For providers with fixed dimensions (Qwen, Voyage, AWS), you must specify `dimensions:` in the config to override the default value in `.env`.

## Vector Store Configuration

Cipher supports three vector databases for storing embeddings. Configure in `.env`:

### Supported Vector Stores

**Qdrant** ([Qdrant Cloud](https://qdrant.tech/))

```bash
# Remote (Qdrant Cloud)
VECTOR_STORE_TYPE=qdrant
VECTOR_STORE_URL=your-qdrant-endpoint
VECTOR_STORE_API_KEY=your-qdrant-api-key

# Local (Docker)
VECTOR_STORE_TYPE=qdrant
VECTOR_STORE_HOST=localhost
VECTOR_STORE_PORT=6333
VECTOR_STORE_URL=http://localhost:6333
```

**Milvus** ([Zilliz Cloud](https://zilliz.com/))

```bash
# Remote (Zilliz Cloud)
VECTOR_STORE_TYPE=milvus
VECTOR_STORE_URL=your-milvus-cluster-endpoint
VECTOR_STORE_USERNAME=your-zilliz-username
VECTOR_STORE_PASSWORD=your-zilliz-password

# Local (Docker)
VECTOR_STORE_TYPE=milvus
VECTOR_STORE_HOST=localhost
VECTOR_STORE_PORT=19530
```

### Additional Vector Store Settings

```bash
# Collection configuration
VECTOR_STORE_COLLECTION=knowledge_memory
VECTOR_STORE_DIMENSION=1536
VECTOR_STORE_DISTANCE=Cosine

# Reflection memory (optional)
REFLECTION_VECTOR_STORE_COLLECTION=reflection_memory
DISABLE_REFLECTION_MEMORY=true
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

### LM Studio (Self-Hosted, No API Key - Now with Embedding Support!)

```yaml
llm:
  provider: lmstudio
  model: hermes-2-pro-llama-3-8b # e.g. TheBloke/Mistral-7B-Instruct-v0.2-GGUF
  # No apiKey required
  # Optionally override the baseURL if not using the default
  # baseURL: http://localhost:1234/v1

# OPTIONAL: Configure specific embedding model
# If not specified, Cipher will automatically try:
# 1. Same model as LLM (if it supports embeddings)
# 2. Default embedding model (nomic-embed-text-v1.5)
# 3. OpenAI fallback (if OPENAI_API_KEY available)
embedding:
  provider: lmstudio
  model: nomic-embed-text-v1.5 # Optional - smart fallback if not specified
  # baseURL: http://localhost:1234/v1
```

> **Note:** LM Studio is fully OpenAI-compatible and now supports both LLM and embedding models! By default, Cipher will connect to LM Studio at `http://localhost:1234/v1`. No API key is required.
>
> **🆕 Embedding Support**: LM Studio now supports embedding models like `nomic-embed-text-v1.5`, `bge-large`, `bge-base`, and other BERT-based models in GGUF format.
>
> **Smart Fallback Logic:**
>
> 1. **First try**: Uses the same model loaded for LLM as the embedding model (many models support both)
> 2. **Second try**: Falls back to `nomic-embed-text-v1.5` if the LLM model doesn't support embeddings
> 3. **Final fallback**: Uses OpenAI embeddings when available

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
cipher --mode mcp                   # MCP server (make sure all necessary environment variables are set in the shell environment)

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

## MseeP.ai Security Assessment Badge

[![MseeP.ai Security Assessment Badge](https://mseep.net/pr/campfirein-cipher-badge.png)](https://mseep.ai/app/campfirein-cipher)

## Star History

<a href="https://star-history.com/#campfirein/cipher&Date">
  <img width="500" alt="Star History Chart" src="https://api.star-history.com/svg?repos=campfirein/cipher&type=Date&v=2">
</a>

## License

Elastic License 2.0. See [LICENSE](LICENSE) for full terms.
