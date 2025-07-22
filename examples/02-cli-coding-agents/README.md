# CLI Coding Agents

> 🖥️ **Memory-powered CLI development with Claude Code and Gemini CLI**

## Overview

This configuration demonstrates Cipher as a memory layer for Claude Code and Gemini CLI. Unlike traditional CLI tools that lose context between sessions, this setup provides persistent memory that grows with your development workflow.

**Key Benefits:**
- **Persistent memory** across CLI sessions
- **Project-aware assistance** that remembers your codebase
- **Cross-session learning** that builds on previous interactions

## Prerequisites

**Required API Keys:**

1. **Anthropic API Key** - Get from [console.anthropic.com](https://console.anthropic.com)
2. **OpenAI API Key** - Get from [platform.openai.com](https://platform.openai.com) (required for embeddings)
3. **Google AI API Key** (optional) - Get from [Google AI Studio](https://aistudio.google.com)

## Setup

### 1. Environment Setup

Set your API keys:
```bash
export ANTHROPIC_API_KEY=your_anthropic_api_key
export OPENAI_API_KEY=your_openai_api_key
export GOOGLE_AI_API_KEY=your_google_ai_api_key  # optional
```

### 2. Claude Code Configuration

Create or edit `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "cipher": {
      "command": "cipher",
      "args": ["--mode", "mcp", "--agent", "./cipher.yml"],
      "env": {
        "ANTHROPIC_API_KEY": "your_anthropic_api_key",
        "OPENAI_API_KEY": "your_openai_api_key"
      }
    }
  }
}
```

### 3. Gemini CLI Configuration

Add to your Gemini CLI `settings.json`:
```json
{
  "mcpServers": {
    "cipher": {
      "command": "cipher",
      "args": ["--mode", "mcp", "--agent", "./cipher.yml"],
      "env": {
        "ANTHROPIC_API_KEY": "your_anthropic_api_key",
        "OPENAI_API_KEY": "your_openai_api_key"
      }
    }
  }
}
```

### 4. Test the Setup

**Claude Code:**
```bash
claude
> Analyze my project structure and remember the patterns
```

**Gemini CLI:**
```bash
gemini "Use cipher to analyze my codebase"
```

## Usage Examples

**Project Analysis:**
```bash
claude> Analyze my project structure and remember the patterns
```

**Cross-Session Learning:**
```bash
# Session 1
claude> Help me debug this React performance issue

# Session 2 (later)
claude> Apply the optimization techniques we discussed yesterday
```

**Code Review:**
```bash
claude> Review my authentication changes using the security patterns you've learned
```

---

This setup provides persistent memory for your CLI development workflow, making your coding agents smarter with every interaction.
