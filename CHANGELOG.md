# Changelog

## [0.2.0] - 2025-07-30

### Added
- **Multi-backend conversation support**  
  Added support for persistent memory across multiple LLM backends using a new architecture. Enables PostgreSQL-based WAL persistence.

- **Google Gemini support**  
  Introduced support for Gemini LLMs and embedding models..

- **Alibaba Cloud Qwen support**  
  Added compatibility for Qwen models.

- **Gemini & Ollama embedding providers**  
  Cipher now supports embedding generation via Google Gemini and Ollama APIs.

- **Embedding fallback mechanism**  
  Implements automatic fallback logic for embeddings. If the primary provider is unavailable, Cipher selects the next available provider based on environment variables.

- **Prompt Provider Support**  
  Added extensible system prompt architecture with dynamic, static, and file-based providers. Enables customizable prompt injection through CLI commands (`/prompt-providers`) with support for conversation summaries, project guidelines, and real-time prompt management.

- **Token Management**  
  Implemented intelligent token counting and context compression with provider-specific tokenization. Features automatic compression when approaching context limits, token usage statistics, and configurable compression strategies for optimal memory management across different LLM providers.

- **Aggregator Mode support**  
  Implements Aggregator mode for Cipher's MCP server, which exposes all Cipher's tools to agents/clients.

---

### Documentation

- **New example: MCP aggregator hub (Use Case 4)**  
  Introduced a new real-world example in `examples/usecase-4`, showing how Cipher can aggregate multiple MCP streams.

- **Improved README and prompt documentation**  
  Updated descriptions, prompt templates, and environment variable explanations to reflect the latest architecture and provider support.

---