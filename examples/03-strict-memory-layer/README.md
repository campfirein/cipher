# Strict Memory Layer (Cipher)

> 🧠 **Dedicated memory service for external agents: fast storage & retrieval**

## Quick Start

1. **Set API Keys:**
```bash
export OPENAI_API_KEY=your_openai_api_key
export ANTHROPIC_API_KEY=your_anthropic_api_key
```

2. **Launch Cipher as MCP Server:**
```bash
cipher --mode mcp --agent ./examples/03-strict-memory-layer/cipher.yml
```

3. **MCP Client Config Example**
(based on your actual mcp.json)
```json
{
  "mcpServers": {
    "cipher": {
      "command": "cipher",
      "args": [
        "--mode", "mcp",
        "--agent", "./examples/03-strict-memory-layer/cipher.yml"
      ],
      "env": {
        "MCP_SERVER_MODE": "default",
        "OPENAI_API_KEY": "sk-...",
        "VECTOR_STORE_TYPE": "milvus",
        "VECTOR_STORE_URL": "...",
        "VECTOR_STORE_API_KEY": "...",
        "VECTOR_STORE_USERNAME": "...",
        "VECTOR_STORE_PASSWORD": "...",
        "VECTOR_STORE_COLLECTION": "knowledge_memory",
        "REFLECTION_VECTOR_STORE_COLLECTION": "reflection_memory",
        "DISABLE_REFLECTION_MEMORY": "false"
      }
    }
  }
}
```

## Usage
- **Only one tool:** `ask_cipher` (handles both storage & retrieval)


## Features
- Fast responses (storage runs in background)
- No explicit memory tool calls needed
- Structured, comprehensive retrieval results

## Troubleshooting
- Ensure API keys are set
- Use MCP_SERVER_MODE=default for strict memory layer
- Only `ask_cipher` is available in this mode

---
This setup provides a pure memory layer for agents, optimized for fast, reliable storage and retrieval.
