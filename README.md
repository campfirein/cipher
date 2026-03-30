# ByteRover CLI

Command-line interface for ByteRover — an interactive REPL for managing your project's context tree and knowledge storage. Integrates with 22+ AI coding agents.

[![Version](https://img.shields.io/npm/v/byterover-cli.svg)](https://npmjs.org/package/byterover-cli)
[![Downloads/week](https://img.shields.io/npm/dw/byterover-cli.svg)](https://npmjs.org/package/byterover-cli)

## Installation

### macOS & Linux (Recommended)

No Node.js required — everything is bundled.

```bash
curl -fsSL https://byterover.dev/install.sh | sh
```

Supported platforms: macOS ARM64, macOS x64 (Intel), Linux x64, Linux ARM64.

### All platforms (via npm)

Requires Node.js >= 20.

```bash
npm install -g byterover-cli
```

### Verify

```bash
brv --version
```

## Quick Start

```bash
cd your/project
brv
```

The REPL auto-configures on first run — no setup needed. Use `/curate` to add knowledge and `/query` to retrieve it:

```
/curate "Auth uses JWT with 24h expiry" @src/middleware/auth.ts
/query How is authentication implemented?
```

Type `/` in the REPL to discover all available commands.

## Documentation

Visit [**docs.byterover.dev**](https://docs.byterover.dev) for full guides on cloud sync, AI agent integrations, LLM providers, and more.

Run `brv --help` for CLI usage.

---

**Copyright (c) ByteRover**
