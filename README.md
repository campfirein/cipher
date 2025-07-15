## Cipher

<div align="center">

<img src="./assets/cipher-logo.png" alt="Cipher Agent Logo" width="400" />

<p align="center">
<em>Memory-powered AI agent framework with MCP integration</em>
</p>

<p align="center">
<a href="LICENSE"><img src="https://img.shields.io/badge/License-Elastic%202.0-blue.svg" alt="License" /></a>
<img src="https://img.shields.io/badge/Status-Beta-orange.svg" alt="Beta" />
<a href="https://discord.com/invite/UMRrpNjh5W"><img src="https://img.shields.io/badge/Discord-Join%20Community-7289da" alt="Discord" /></a>
</p>

</div>

## Overview

_`cipher`_ is a simple, composable framework to build memory for agents using [Model Context Protocol](https://modelcontextprotocol.io/introduction).

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

### Quick Start with Docker (Recommended)

The fastest way to get Cipher running is with Docker:

```bash
# 1. Clone the repository
git clone https://github.com/your-repo/cipher.git
cd cipher

# 2. Copy and configure environment variables
cp .env.example .env
# Edit .env with your API keys (see Environment Setup below)

# 3. Start with Docker Compose
docker-compose up -d

# 4. Test the API
curl http://localhost:3000/health
```

### Build from Source

```bash
# build from source
pnpm i && pnpm run build && npm link
```

### Environment Setup

Before running Cipher, you need to configure your environment variables. Copy the example file and add your API keys:

```bash
cp .env.example .env
```

Edit the `.env` file and add at least one API key:

```bash
# Required: At least one API key
OPENAI_API_KEY=your_openai_api_key_here
ANTHROPIC_API_KEY=your_anthropic_api_key_here
OPENROUTER_API_KEY=your_openrouter_api_key_here

# Optional: For local models (no API key needed)
OLLAMA_BASE_URL=http://localhost:11434/v1

# Optional: Additional configuration
CIPHER_LOG_LEVEL=info
NODE_ENV=production
```

## Run Modes

Cipher supports multiple operational modes to fit different usage patterns:

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
- Rich command system with slash commands
- Session management capabilities
- Graceful exit with `exit` or `quit` commands
- Signal handling (Ctrl+C) for clean shutdown
- Smart logging: Shows AI thinking steps (💭) and tool usage (🔧) in info mode, detailed context in debug mode

### One-Shot Mode (Headless)

Execute a single prompt and exit without starting an interactive session:

```bash
# One-shot command execution
cipher "what is ourn own logics of implementing the binary search tree?"
cipher task "store this logics (logics...) to the memory"

# Works with all existing flags
cipher --strict "analyze this code"
cipher --new-session debug-session "fix this bug"
cipher --mode cli "remember this important detail"
```

**Key Features:**

- **Quick Execution**: Run a single prompt and exit immediately
- **Full Compatibility**: Works with all existing CLI flags (`--strict`, `--new-session`, `--mode`, etc.)
- **Memory Integration**: All interactions are stored in memory for future reference
- **Processing Feedback**: Shows "🤔 Processing..." indicator while working
- **Error Handling**: Comprehensive error handling with meaningful messages
- **Clean Exit**: Proper process termination after execution

**Usage Examples:**

```bash
# Simple one-shot command
cipher "What's the weather like?"

# Store information to memory
cipher "Remember that I'm working on the authentication module"

# Quick analysis with strict mode
cipher --strict "Analyze this error message for me"

# Create a new session and execute
cipher --new-session analysis-work "Help me understand this algorithm"

# Use with custom agent configuration
cipher --agent ./my-config.yml "Process this data"
```

The one-shot mode is perfect for:

- Quick queries that don't need ongoing conversation
- Storing information to memory from scripts
- Integrating cipher into automated workflows
- Testing prompts without starting interactive mode

## Using Custom Metadata in Cipher CLI

Firstly, start the interactive CLI

```sh
# Start with node command
node dist/cli.js
```

or

```sh
# Start with pnpm command
pnpm cli
```

Then, to send custom metadata with your message, use the `!meta` command:

```bash
# Command:
cipher> !meta key1=value1,key2=value2 Your message here

# Example:
cipher> !meta foo=bar,baz=qux The capital of France is Paris.
```

This attaches `{ foo: "bar", baz: "qux" }` as metadata to the message.

### API Mode (REST Server)

Runs cipher as a REST API server, allowing HTTP clients to interact with the agent programmatically:

```bash
# Run as API server (default: localhost:3000)
cipher --mode api

# Run on custom host/port
cipher --mode api --host 0.0.0.0 --port 8080
```

**Features:**

- RESTful API endpoints for agent interaction
- Session management via HTTP requests
- Message processing with image support
- Health check endpoints
- CORS support for web applications
- Request/response logging and security middleware
- Rate limiting for API protection

### MCP Server Mode

Runs cipher as a Model Context Protocol server, exposing the full AI agent as an MCP server that other MCP-compatible tools can connect to and interact with:

```bash
# Run as MCP server
cipher --mode mcp
```

**Features:**

- **Full Agent Exposure**: Exposes the complete Cipher agent as an MCP server
- **ask_cipher Tool**: Primary tool for chatting with the agent via MCP protocol
- **Agent Resources**: Exposes agent metadata and runtime statistics
- **System Prompts**: Access to current system prompts used by the agent
- **Session Management**: Maintains conversation context across MCP client connections
- **Stdio Transport**: Uses stdio for direct process communication with MCP clients
- **Log Redirection**: Automatically redirects logs to file to prevent stdio interference
- **Memory Integration**: Full access to agent's memory and learning capabilities

**Available MCP Capabilities:**

- **Tools**:
  - `ask_cipher`: Send messages to interact with the Cipher agent
    - Parameters: `message` (required), `session_id` (optional), `stream` (optional)
    - Returns: Agent response as formatted text

- **Resources**:
  - `cipher://agent/card`: Agent metadata and configuration information
  - `cipher://agent/stats`: Runtime statistics including session count, MCP connections, uptime, and memory usage

- **Prompts**:
  - `system_prompt`: Retrieve the current system prompt used by the agent

**Usage Example with MCP Client:**

```bash
# Start cipher as MCP server
cipher --mode mcp

# In another terminal, connect with an MCP client
# The server will be available via stdio transport
```

**Integration with MCP-compatible Tools:**

The MCP server mode allows Cipher to integrate with any MCP-compatible tool or client, including:

- VS Code extensions with MCP support
- Claude Desktop with MCP server configuration
- Custom MCP clients and tools
- Other AI agents that support MCP protocol

This mode transforms Cipher into a reusable agent service that can be accessed by multiple tools simultaneously while maintaining persistent memory and learning capabilities.

### Prerequisites

Before running cipher in any mode, ensure you have:

1. **Environment Configuration**: Copy `.env.example` to `.env` and configure at least one API provider:

   ```bash
   cp .env.example .env
   # Edit .env and add your API keys
   ```

2. **API Keys**: Set at least one of these in your `.env` file (or use Ollama for local models):
   - `OPENAI_API_KEY` for OpenAI models
   - `ANTHROPIC_API_KEY` for Anthropic Claude models
   - `OPENROUTER_API_KEY` for OpenRouter (200+ models)
   - `OLLAMA_BASE_URL` for Ollama local models (no API key required)

3. **Agent Configuration**: The agent uses `memAgent/cipher.yml` for configuration (included in the project)

### Additional Options

```bash
# Use custom agent config file
cipher --agent /path/to/custom/config.yml
cipher -a /path/to/custom/config.yml

# Require all MCP server connections to succeed (strict mode)
cipher --strict
cipher -s

# Start with a new session
cipher --new-session                    # Auto-generated session ID
cipher --new-session myCustomSession    # Custom session ID

# Disable verbose output
cipher --no-verbose

# Show version
cipher --version

# Show help
cipher --help
```

### Command Line Interface

Cipher provides a rich interactive CLI with various commands for managing sessions, system information, and agent interactions:

#### Session Management Commands

```bash
# Session commands (alias: /s)
/session help                 # Show session management help
/session list                 # List all active sessions
/session new [sessionId]      # Create new session (optional custom ID)
/session switch <sessionId>   # Switch to a different session
/session current              # Show current session information
/session delete <sessionId>   # Delete a session (cannot delete active session)

# Session command aliases
/s list                       # Same as /session list
/s new mySession             # Same as /session new mySession
/s sw sessionId              # Same as /session switch sessionId
/s curr                      # Same as /session current
/s del sessionId             # Same as /session delete sessionId
```

#### System Information Commands

```bash
# System and configuration
/config                      # Display current agent configuration
/stats                       # Show system statistics and metrics
/prompt                      # Display current system prompt
/tools                       # List all available MCP tools

# Basic commands
/help [command]              # Show help (alias: /h, /?)
/clear                       # Reset conversation history (alias: /reset)
/exit                        # Exit the CLI session (alias: /quit, /q)
```

#### Interactive Features

- **Tab Completion**: Use Tab key for command auto-completion
- **Command History**: Navigate previous commands with arrow keys
- **Colored Output**: Commands use color coding for better readability
- **Error Handling**: Comprehensive error messages with helpful guidance
- **Session Persistence**: Conversations are saved across sessions with memory integration

#### Usage Examples

**Session Management Workflow:**

```bash
# Start cipher and create a new session
cipher --new-session work-project

# In the CLI, create additional sessions
/session new personal-chat
/session new research-notes

# List all sessions
/session list

# Switch between sessions
/session switch work-project
/session current

# Delete a session (must switch away first)
/session switch personal-chat
/session delete research-notes
```

**Configuration and Startup:**

```bash
# Start with custom config and strict mode
cipher --agent ./my-config.yml --strict

# Start with new session and verbose logging
cipher --new-session experiment-1 --verbose

# Quick start with all features
cipher -a custom.yml -s --new-session main-session
```

## API Usage

When running cipher in API mode (`--mode api`), it exposes a comprehensive REST API for programmatic interaction with the agent. The API provides endpoints for message processing, session management, and system information.

### Starting the API Server

```bash
# Start API server on default port (3000)
cipher --mode api

# Start on custom host and port
cipher --mode api --host 0.0.0.0 --port 8080

# Start with specific agent configuration
cipher --mode api --agent ./custom-config.yml --port 5000
```

### API Endpoints

#### Health Check

```bash
# Check if the API server is running
GET /health

# Response:
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "uptime": 3600.5,
  "version": "1.0.0"
}
```

#### Message Processing

**Send Message to Agent**

```bash
# Process a message synchronously
POST /api/message/sync
Content-Type: application/json

{
  "message": "Hello, how are you?",
  "sessionId": "my-session-id",        # Optional: defaults to current session
  "images": ["base64-encoded-image"]   # Optional: array of base64 images
}

# Response:
{
  "success": true,
  "data": {
    "response": "Hello! I'm doing well, thank you for asking...",
    "sessionId": "my-session-id",
    "timestamp": "2024-01-15T10:30:00.000Z"
  },
  "requestId": "req-123456"
}
```

**Reset Conversation**

```bash
# Reset current session's conversation history
POST /api/message/reset
Content-Type: application/json

{
  "sessionId": "my-session-id"  # Optional: defaults to current session
}

# Response:
{
  "success": true,
  "data": {
    "message": "Session my-session-id has been reset",
    "sessionId": "my-session-id",
    "timestamp": "2024-01-15T10:30:00.000Z"
  },
  "requestId": "req-123456"
}
```

#### Session Management

**List All Sessions**

```bash
# Get all active sessions with metadata
GET /api/sessions

# Response:
{
  "success": true,
  "data": {
    "sessions": [
      {
        "id": "session-1",
        "messageCount": 15,
        "createdAt": "2024-01-15T09:00:00.000Z",
        "lastActivity": "2024-01-15T10:25:00.000Z"
      }
    ],
    "count": 1,
    "currentSession": "session-1"
  },
  "requestId": "req-123456"
}
```

**Create New Session**

```bash
# Create a new session
POST /api/sessions
Content-Type: application/json

{
  "sessionId": "custom-session-id"  # Optional: auto-generated if not provided
}

# Response:
{
  "success": true,
  "data": {
    "sessionId": "custom-session-id",
    "created": true,
    "timestamp": "2024-01-15T10:30:00.000Z"
  },
  "requestId": "req-123456"
}
```

**Get Current Session**

```bash
# Get current active session information
GET /api/sessions/current

# Response:
{
  "success": true,
  "data": {
    "sessionId": "current-session-id",
    "metadata": {
      "id": "current-session-id",
      "messageCount": 5,
      "createdAt": "2024-01-15T10:00:00.000Z",
      "lastActivity": "2024-01-15T10:30:00.000Z"
    },
    "isCurrent": true
  },
  "requestId": "req-123456"
}
```

**Get Session Details**

```bash
# Get specific session information
GET /api/sessions/{sessionId}

# Response:
{
  "success": true,
  "data": {
    "sessionId": "session-123",
    "metadata": {
      "id": "session-123",
      "messageCount": 10,
      "createdAt": "2024-01-15T09:30:00.000Z",
      "lastActivity": "2024-01-15T10:15:00.000Z"
    },
    "isCurrent": false
  },
  "requestId": "req-123456"
}
```

**Load Session (Switch To)**

```bash
# Switch to a different session
POST /api/sessions/{sessionId}/load

# Response:
{
  "success": true,
  "data": {
    "sessionId": "session-123",
    "loaded": true,
    "currentSession": "session-123",
    "timestamp": "2024-01-15T10:30:00.000Z"
  },
  "requestId": "req-123456"
}
```

**Get Session History**

```bash
# Get conversation history for a session
GET /api/sessions/{sessionId}/history

# Response:
{
  "success": true,
  "data": {
    "sessionId": "session-123",
    "history": [
      {
        "role": "user",
        "content": "Hello",
        "timestamp": "2024-01-15T10:00:00.000Z"
      },
      {
        "role": "assistant",
        "content": "Hello! How can I help you today?",
        "timestamp": "2024-01-15T10:00:05.000Z"
      }
    ],
    "count": 2,
    "timestamp": "2024-01-15T10:30:00.000Z"
  },
  "requestId": "req-123456"
}
```

**Delete Session**

```bash
# Delete a session (cannot delete currently active session)
DELETE /api/sessions/{sessionId}

# Response:
{
  "success": true,
  "data": {
    "sessionId": "session-123",
    "deleted": true,
    "timestamp": "2024-01-15T10:30:00.000Z"
  },
  "requestId": "req-123456"
}
```

### Error Handling

The API uses standardized error responses:

```bash
# Example error response
{
  "success": false,
  "error": {
    "code": "SESSION_NOT_FOUND",
    "message": "Session session-123 not found",
    "timestamp": "2024-01-15T10:30:00.000Z"
  },
  "requestId": "req-123456"
}
```

**Common Error Codes:**

- `VALIDATION_ERROR`: Invalid request parameters
- `SESSION_NOT_FOUND`: Session doesn't exist
- `INTERNAL_ERROR`: Server-side error
- `RATE_LIMIT_EXCEEDED`: Too many requests
- `BAD_REQUEST`: Malformed request
- `UNAUTHORIZED`: Authentication required (if implemented)

### API Usage Examples

**Using curl:**

```bash
# Start cipher API server
cipher --mode api --port 3000

# Send a message
curl -X POST http://localhost:3000/api/message/sync \
  -H "Content-Type: application/json" \
  -d '{"message": "What is the weather like?"}'

# Create a new session
curl -X POST http://localhost:3000/api/sessions \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "weather-chat"}'

# List all sessions
curl http://localhost:3000/api/sessions

# Get session history
curl http://localhost:3000/api/sessions/weather-chat/history
```

**Using JavaScript/Node.js:**

```javascript
// Example client for cipher API
class CipherClient {
	constructor(baseUrl = 'http://localhost:3000') {
		this.baseUrl = baseUrl;
	}

	async sendMessage(message, sessionId = null, images = null) {
		const response = await fetch(`${this.baseUrl}/api/message/sync`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				message,
				sessionId,
				images,
			}),
		});

		return response.json();
	}

	async createSession(sessionId = null) {
		const response = await fetch(`${this.baseUrl}/api/sessions`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ sessionId }),
		});

		return response.json();
	}

	async listSessions() {
		const response = await fetch(`${this.baseUrl}/api/sessions`);
		return response.json();
	}

	async getSessionHistory(sessionId) {
		const response = await fetch(`${this.baseUrl}/api/sessions/${sessionId}/history`);
		return response.json();
	}
}

// Usage example
const client = new CipherClient();

(async () => {
	// Create a new session
	const session = await client.createSession('my-chat');
	console.log('Created session:', session.data.sessionId);

	// Send a message
	const response = await client.sendMessage('Hello, cipher!', session.data.sessionId);
	console.log('Agent response:', response.data.response);

	// Get conversation history
	const history = await client.getSessionHistory(session.data.sessionId);
	console.log('Chat history:', history.data.history);
})();
```

**Using Python:**

```python
import requests
import json

class CipherClient:
    def __init__(self, base_url="http://localhost:3000"):
        self.base_url = base_url
        self.session = requests.Session()

    def send_message(self, message, session_id=None, images=None):
        url = f"{self.base_url}/api/message/sync"
        data = {"message": message}

        if session_id:
            data["sessionId"] = session_id
        if images:
            data["images"] = images

        response = self.session.post(url, json=data)
        return response.json()

    def create_session(self, session_id=None):
        url = f"{self.base_url}/api/sessions"
        data = {}
        if session_id:
            data["sessionId"] = session_id

        response = self.session.post(url, json=data)
        return response.json()

    def list_sessions(self):
        url = f"{self.base_url}/api/sessions"
        response = self.session.get(url)
        return response.json()

    def get_session_history(self, session_id):
        url = f"{self.base_url}/api/sessions/{session_id}/history"
        response = self.session.get(url)
        return response.json()

# Usage example
client = CipherClient()

# Create a new session
session = client.create_session("python-chat")
print(f"Created session: {session['data']['sessionId']}")

# Send a message
response = client.send_message("Hello from Python!", session['data']['sessionId'])
print(f"Agent response: {response['data']['response']}")

# Get conversation history
history = client.get_session_history(session['data']['sessionId'])
print(f"Chat history: {history['data']['history']}")
```

### API Server Configuration

The API server supports various configuration options:

```bash
# Custom host and port
cipher --mode api --host 0.0.0.0 --port 8080

# With custom agent configuration
cipher --mode api --agent ./my-config.yml --port 5000

# Combined with other options
cipher --mode api --host 0.0.0.0 --port 8080 --agent ./config.yml --strict
```

## Docker Deployment

Cipher can be easily deployed as a Docker container for production use. The Docker setup provides a secure, optimized environment for running Cipher in API mode.

### Quick Start with Docker

**Prerequisites:**

- Docker and Docker Compose installed on your system
- A configured `.env` file with your API keys

**Step 1: Prepare Environment**

```bash
# Copy and configure environment variables
cp .env.example .env

# Edit .env with your API keys
nano .env  # or use your preferred editor
```

**Step 2: Start with Docker Compose (Recommended)**

```bash
# Start the service
docker-compose up -d

# Check if it's running
docker-compose ps
```

**Step 3: Test the API**

```bash
# Health check
curl http://localhost:3000/health

# Should return: {"status":"healthy","timestamp":"...","uptime":...}
```

### Manual Docker Commands

If you prefer to use Docker directly without Docker Compose:

**Build the image:**

```bash
docker build -t cipher-api .
```

**Run with environment file:**

```bash
docker run -d -p 3000:3000 --name cipher-api --env-file .env cipher-api
```

**Run with individual environment variables:**

```bash
docker run -d -p 3000:3000 --name cipher-api \
  -e OPENAI_API_KEY="your_openai_api_key" \
  -e NODE_ENV=production \
  cipher-api
```

### Testing Your Docker Setup

Once your container is running, test all the key functionalities:

**1. Health Check**

```bash
curl http://localhost:3000/health
# Expected: {"status":"healthy","timestamp":"...","uptime":...}
```

**2. Send a Message**

```bash
curl -X POST http://localhost:3000/api/message/sync \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello, how are you?"}'
```

**3. Session Management**

```bash
# Create a new session
curl -X POST http://localhost:3000/api/sessions \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "my-test-session"}'

# List all sessions
curl http://localhost:3000/api/sessions

# Send message to specific session
curl -X POST http://localhost:3000/api/message/sync \
  -H "Content-Type: application/json" \
  -d '{"message": "Tell me about Docker", "sessionId": "my-test-session"}'

# Get conversation history
curl http://localhost:3000/api/sessions/my-test-session/history
```

**4. Validate Container Health**

```bash
# Check container status
docker ps

# View logs
docker logs cipher-api  # or docker-compose logs cipher-api

# Check container stats
docker stats cipher-api
```

### Troubleshooting Docker Setup

**Container won't start:**

```bash
# Check logs for errors
docker logs cipher-api

# Common issues:
# 1. Missing API keys - check your .env file
# 2. Port already in use - change port mapping
# 3. Invalid environment variables
```

**API not responding:**

```bash
# Check if container is running
docker ps

# Test from inside container
docker exec cipher-api wget -qO- http://localhost:3000/health

# Check port binding
docker port cipher-api
```

**Environment Variables not working:**

```bash
# Verify .env file exists and has proper format
cat .env

# Check if variables are loaded in container
docker exec cipher-api env | grep -E "(OPENAI|ANTHROPIC|OPENROUTER)"
```

### Docker Management Commands

```bash
# View running containers
docker-compose ps

# Stop the service
docker-compose stop

# Start the service
docker-compose start

# Restart the service
docker-compose restart

# View logs
docker-compose logs -f cipher-api

# Stop and remove containers
docker-compose down

# Stop and remove containers + volumes
docker-compose down -v
```

### Simple Test Script

For convenience, here's a simple test script you can save as `test-docker.sh`:

```bash
#!/bin/bash
# test-docker.sh - Simple Docker test script

echo "🐳 Testing Cipher Docker API..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test function
test_endpoint() {
    local url=$1
    local description=$2
    local expected_status=${3:-200}

    echo -n "Testing $description... "

    response=$(curl -s -w "%{http_code}" -o /tmp/response.json "$url")
    status_code="${response: -3}"

    if [ "$status_code" -eq "$expected_status" ]; then
        echo -e "${GREEN}✓ PASS${NC}"
        return 0
    else
        echo -e "${RED}✗ FAIL (HTTP $status_code)${NC}"
        echo "Response: $(cat /tmp/response.json)"
        return 1
    fi
}

# Test POST function
test_post() {
    local url=$1
    local data=$2
    local description=$3

    echo -n "Testing $description... "

    response=$(curl -s -w "%{http_code}" -X POST -H "Content-Type: application/json" -d "$data" -o /tmp/response.json "$url")
    status_code="${response: -3}"

    if [ "$status_code" -eq 200 ]; then
        echo -e "${GREEN}✓ PASS${NC}"
        return 0
    else
        echo -e "${RED}✗ FAIL (HTTP $status_code)${NC}"
        echo "Response: $(cat /tmp/response.json)"
        return 1
    fi
}

# Wait for container to be ready
echo "Waiting for container to be ready..."
sleep 5

# Run tests
echo -e "${YELLOW}🧪 Running API Tests...${NC}"
echo

# Test 1: Health check
test_endpoint "http://localhost:3000/health" "Health Check"

# Test 2: Session list
test_endpoint "http://localhost:3000/api/sessions" "Session List"

# Test 3: Create session
test_post "http://localhost:3000/api/sessions" '{"sessionId": "test-session"}' "Create Session"

# Test 4: Send message
test_post "http://localhost:3000/api/message/sync" '{"message": "Hello Docker!"}' "Send Message"

# Test 5: Session history
test_endpoint "http://localhost:3000/api/sessions/test-session/history" "Session History"

echo
echo -e "${GREEN}🎉 All tests completed!${NC}"
echo "Container is ready to use at http://localhost:3000"
```

**Usage:**

```bash
# Make the script executable
chmod +x test-docker.sh

# Run the tests
./test-docker.sh
```

### Advanced Docker Configuration

#### Building the Docker Image

```bash
# Build the Docker image
docker build -t cipher-api .

# Build with custom build arguments
docker build --build-arg NODE_VERSION=20.18.1 -t cipher-api .
```

#### Running the Container

**Basic Usage:**

```bash
# Run with default configuration
docker run -p 3000:3000 --env-file .env cipher-api

# Run with custom port
docker run -p 8080:8080 --env-file .env -e PORT=8080 cipher-api

# Run in detached mode
docker run -d -p 3000:3000 --env-file .env --name cipher-api cipher-api
```

**With Custom Configuration:**

```bash
# Mount custom agent configuration
docker run -p 3000:3000 \
  --env-file .env \
  -v $(pwd)/my-config.yml:/app/memAgent/cipher.yml \
  cipher-api

# Mount custom agent directory
docker run -p 3000:3000 \
  --env-file .env \
  -v $(pwd)/my-agent:/app/memAgent \
  cipher-api
```

**Production Deployment:**

```bash
# Run with health checks and restart policy
docker run -d \
  --name cipher-api \
  --restart unless-stopped \
  -p 3000:3000 \
  --env-file .env \
  --health-cmd="curl -f http://localhost:3000/health || exit 1" \
  --health-interval=30s \
  --health-timeout=10s \
  --health-retries=3 \
  cipher-api
```

#### Docker Compose

For easier deployment and management, use Docker Compose:

```yaml
# docker-compose.yml
version: '3.8'

services:
  cipher-api:
    build: .
    ports:
      - '3000:3000'
    environment:
      - PORT=3000
      - NODE_ENV=production
    env_file:
      - .env
    volumes:
      - ./memAgent:/app/memAgent:ro # Mount custom agent config
      - cipher-data:/app/.cipher # Persist application data
    restart: unless-stopped
    healthcheck:
      test: ['CMD', 'curl', '-f', 'http://localhost:3000/health']
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

volumes:
  cipher-data:
```

**Deploy with Docker Compose:**

```bash
# Start the service
docker-compose up -d

# View logs
docker-compose logs -f cipher-api

# Stop the service
docker-compose down
```

### Docker Configuration

#### Environment Variables

The Docker container supports all standard Cipher environment variables:

```bash
# Required: At least one API key
OPENAI_API_KEY=your_openai_api_key
ANTHROPIC_API_KEY=your_anthropic_api_key
OPENROUTER_API_KEY=your_openrouter_api_key
OLLAMA_BASE_URL=http://localhost:11434/v1

# Container-specific
PORT=3000                    # API server port
NODE_ENV=production          # Node.js environment
CONFIG_FILE=/app/memAgent/cipher.yml  # Agent configuration path

# Optional: Storage and logging
CIPHER_LOG_LEVEL=info
STORAGE_DATABASE_TYPE=sqlite
STORAGE_DATABASE_PATH=/app/.cipher/database
```

#### Volume Mounts

**Configuration Volume:**

```bash
# Mount custom agent configuration
-v $(pwd)/my-config.yml:/app/memAgent/cipher.yml:ro
```

**Data Persistence:**

```bash
# Persist application data (database, logs, etc.)
-v cipher-data:/app/.cipher
```

**Development Mode:**

```bash
# Mount entire memAgent directory for development
-v $(pwd)/memAgent:/app/memAgent:ro
```

#### Health Checks

The Docker container includes built-in health checks:

```bash
# Check container health
docker exec cipher-api curl -f http://localhost:3000/health

# View health status
docker inspect cipher-api --format='{{.State.Health.Status}}'
```

### Production Considerations

#### Security

- Container runs as non-root user `cipher` (UID 1001)
- Minimal Alpine Linux base image
- Only essential production dependencies included
- Secrets should be passed via environment variables or Docker secrets

#### Scaling

```bash
# Run multiple instances with load balancer
docker run -d -p 3001:3000 --env-file .env --name cipher-api-1 cipher-api
docker run -d -p 3002:3000 --env-file .env --name cipher-api-2 cipher-api
docker run -d -p 3003:3000 --env-file .env --name cipher-api-3 cipher-api
```

#### Monitoring

```bash
# View container logs
docker logs -f cipher-api

# Monitor resource usage
docker stats cipher-api

# Execute commands in running container
docker exec -it cipher-api sh
```

### Troubleshooting

**Common Issues:**

1. **Port Already in Use:**

   ```bash
   # Use different port
   docker run -p 8080:3000 --env-file .env cipher-api
   ```

2. **Missing API Keys:**

   ```bash
   # Check environment variables
   docker exec cipher-api env | grep -E "(OPENAI|ANTHROPIC|OPENROUTER)"
   ```

3. **Configuration File Not Found:**

   ```bash
   # Verify mount and file exists
   docker exec cipher-api ls -la /app/memAgent/
   ```

4. **Container Won't Start:**
   ```bash
   # Check logs for startup errors
   docker logs cipher-api
   ```

### Development with Docker

For development, you can mount the source code and run in development mode:

```bash
# Development setup with source code mounting
docker run -it --rm \
  -p 3000:3000 \
  --env-file .env \
  -v $(pwd):/app \
  -w /app \
  node:20.18.1-alpine \
  sh -c "npm install && npm run dev"
```

## Configuration

Cipher uses a YAML configuration file (`memAgent/cipher.yml`) and environment variables for setup. The configuration is validated using strict schemas to ensure reliability.

### Configuration File Structure

The main configuration file is located at `memAgent/cipher.yml` and follows this structure:

```yaml
# LLM Configuration (Required)
llm:
  provider: openai # Required: 'openai', 'anthropic', 'openrouter', or 'ollama'
  model: gpt-4.1-mini # Required: Model name for the provider
  apiKey: $OPENAI_API_KEY # Required: API key (supports env vars with $VAR syntax, not needed for Ollama)
  maxIterations: 50 # Optional: Max iterations for agentic loops (default: 50)
  baseURL: https://api.openai.com/v1 # Optional: Custom API base URL (OpenAI only)

# System Prompt (Required)
systemPrompt: 'You are a helpful AI assistant with memory capabilities.'

# MCP Servers Configuration (Optional)
mcpServers:
  filesystem: # Server name (can be any identifier)
    type: stdio # Connection type: 'stdio', 'sse', or 'http'
    command: npx # Command to launch the server
    args: # Arguments for the command
      - -y
      - '@modelcontextprotocol/server-filesystem'
      - .
    env: # Environment variables for the server
      HOME: /Users/username
    timeout: 30000 # Connection timeout in ms (default: 30000)
    connectionMode: lenient # 'strict' or 'lenient' (default: lenient)

# Session Management (Optional)
sessions:
  maxSessions: 100 # Maximum concurrent sessions (default: 100)
  sessionTTL: 3600000 # Session TTL in milliseconds (default: 1 hour)

# Agent Card (Optional) - for MCP server mode
agentCard:
  name: cipher # Agent name (default: cipher)
  description: 'Custom description' # Agent description
  version: '1.0.0' # Version (default: 1.0.0)
  provider:
    organization: your-org # Organization name
    url: https://your-site.com # Organization URL
```

### Environment Variables

Create a `.env` file in the project root for sensitive configuration:

```bash
# API Keys (at least one required, EXCEPT for Ollama which is self-hosted)
OPENAI_API_KEY=your_openai_api_key_here
ANTHROPIC_API_KEY=your_anthropic_api_key_here
OPENROUTER_API_KEY=your_openrouter_api_key_here

# API Configuration (optional)
OPENAI_BASE_URL=https://api.openai.com/v1

# Ollama Configuration (for self-hosted local models - NO API KEY NEEDED)
OLLAMA_BASE_URL=http://localhost:11434/v1  # Points to your local Ollama instance

# Logger Configuration (optional)
CIPHER_LOG_LEVEL=info             # debug, info, warn, error
REDACT_SECRETS=true               # true/false - redact sensitive info in logs

# Logging Level Guide:
# - info: Shows AI thinking steps (💭) and tool usage (🔧) for user-friendly output
# - debug: Shows detailed message context and internal processing information
# - warn/error: Shows warnings and errors only

# Storage Configuration (optional)
STORAGE_CACHE_TYPE=in-memory      # redis, in-memory
STORAGE_CACHE_HOST=localhost      # Redis host (if using redis)
STORAGE_CACHE_PORT=6379           # Redis port (if using redis)
STORAGE_CACHE_PASSWORD=           # Redis password (if using redis)
STORAGE_CACHE_DATABASE=0          # Redis database number (if using redis)

STORAGE_DATABASE_TYPE=in-memory   # sqlite, in-memory
STORAGE_DATABASE_PATH=./data      # SQLite database path (if using sqlite)
STORAGE_DATABASE_NAME=cipher.db   # SQLite database name (if using sqlite)
```

### LLM Provider Configuration

#### OpenAI

```yaml
llm:
  provider: openai
  model: gpt-4.1 # or o4-mini, etc.
  apiKey: $OPENAI_API_KEY
  baseURL: https://api.openai.com/v1 # Optional: for custom endpoints
```

#### Anthropic Claude

```yaml
llm:
  provider: anthropic
  model: claude-4-sonnet-20250514 # or claude-3-7-sonnet-20250219, etc.
  apiKey: $ANTHROPIC_API_KEY
```

#### OpenRouter

```yaml
llm:
  provider: openrouter
  model: openai/gpt-4.1 # Any model available on OpenRouter
  apiKey: $OPENROUTER_API_KEY
```

#### Ollama (Self-Hosted Models)

```yaml
llm:
  provider: ollama
  model: qwen3:32b # Use larger models for better performance (see model selection guide below)
  # apiKey: NOT REQUIRED             # Ollama is self-hosted, no API key needed
  baseURL: $OLLAMA_BASE_URL # Optional: defaults to http://localhost:11434/v1
  maxIterations: 50 # Optional: for agentic tool calling loops
```

**Note**: Ollama is unique among providers as it runs locally on your machine. No API key or internet connection is required for inference - only the `OLLAMA_BASE_URL` environment variable pointing to your local Ollama instance.

**OpenRouter Model Examples:**

- `openai/gpt-4.1`, `openai/gpt-4.1-mini`
- `anthropic/claude-3.5-sonnet`, `anthropic/claude-3-haiku`
- `google/gemini-pro-1.5`, `meta-llama/llama-3.1-8b-instruct`
- See [OpenRouter models](https://openrouter.ai/models) for full list

### Connection Modes

MCP servers support two connection modes:

- **`lenient` (default)**: Failed connections are logged as warnings but don't prevent startup
- **`strict`**: Failed connections cause the application to exit with an error

You can override connection modes globally using the `--strict` CLI flag, which makes all MCP servers use strict mode regardless of their individual configuration.

```bash
# Force all MCP servers to use strict mode
cipher --strict

# Use individual server connection modes (default behavior)
cipher
```

### MCP Server Types

#### Stdio Servers (Local Processes)

```yaml
mcpServers:
  myserver:
    type: stdio
    command: node # or python, uvx, etc.
    args: ['server.js', '--port=3000']
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
      Authorization: 'Bearer $TOKEN'
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
      Authorization: 'Bearer $TOKEN'
      User-Agent: 'Cipher/1.0'
    timeout: 30000
    connectionMode: lenient
```

### Configuration Validation

Cipher validates all configuration at startup:

- **LLM Provider**: Must be 'openai', 'anthropic', 'openrouter', or 'ollama'
- **API Keys**: Must be non-empty strings for cloud providers (OpenAI, Anthropic, OpenRouter). **NOT required for Ollama** since it's self-hosted
- **URLs**: Must be valid URLs when provided
- **Numbers**: Must be positive integers where specified
- **MCP Server Types**: Must be 'stdio', 'sse', or 'http'

### Environment Variable Expansion

You can use environment variables anywhere in the YAML configuration:

```yaml
llm:
  apiKey: $OPENAI_API_KEY # Simple expansion
  baseURL: ${API_BASE_URL} # Brace syntax
  model: ${MODEL_NAME:-gpt-4.1} # With default value (syntax may vary)
```

### Configuration Loading

Cipher uses intelligent path resolution for configuration files:

1. **Default behavior**: Looks for `memAgent/cipher.yml` relative to the package installation root
2. **Custom config with `--agent`**:
   - Absolute paths are used as-is
   - Relative paths are resolved relative to the current working directory
   - Default path is resolved relative to the package installation root
3. Environment variables are loaded from `.env` if present
4. Configuration is parsed, validated, and environment variables are expanded

**Examples:**

```bash
# Use default config (memAgent/cipher.yml in package root)
cipher

# Use custom config with absolute path
cipher --agent /home/user/my-config.yml

# Use custom config with relative path (relative to current directory)
cipher --agent ./configs/custom.yml

# Use config in current directory
cipher -a cipher-custom.yml
```

## Capabilities

### Session Management

Cipher provides advanced session management capabilities for maintaining separate conversation contexts:

- **Multiple Sessions**: Create and manage multiple conversation sessions simultaneously
- **Session Persistence**: Each session maintains its own conversation history and context
- **Session Switching**: Seamlessly switch between different sessions during CLI interactions
- **Memory Integration**: All sessions integrate with the agent's memory system for learning and retention
- **Session Lifecycle**: Automatic session cleanup with configurable TTL and maximum session limits
- **CLI Integration**: Full command-line interface for session operations with intuitive commands

**Key Features:**

- Auto-generated or custom session IDs
- Session metadata tracking (creation time, last activity, message count)
- Protection against deleting active sessions
- Session listing with visual indicators for the current active session
- Integration with the `--new-session` CLI flag for immediate session creation

### MCP Integration

Cipher handles all the complexity of MCP server connections and lifecycle management, providing seamless integration with MCP-compatible tools and services.

### Enhanced LLM Provider Support

Cipher now supports multiple LLM providers with seamless integration and advanced capabilities:

### Knowledge Graph Memory

Cipher features a sophisticated knowledge graph system that provides structured, persistent memory for agents. This system enables agents to build and maintain complex relationships between entities, concepts, and information across conversations.

#### Overview

The knowledge graph memory system transforms unstructured conversational data into a structured graph of entities and relationships. Unlike traditional flat memory systems, knowledge graphs excel at:

- **Relationship Modeling**: Capture complex relationships between entities (e.g., "John works at Google as a Software Engineer")
- **Semantic Search**: Find related information through graph traversal and relationship patterns
- **Knowledge Evolution**: Update and evolve understanding as new information becomes available
- **Contextual Retrieval**: Retrieve relevant information based on entity relationships and graph structure

#### Supported Backends

**Neo4j**

- Full-featured graph database with Cypher query support
- Advanced indexing and query optimization
- ACID transactions and data consistency
- Suitable for production workloads and complex graph operations

**In-Memory**

- Fast local storage ideal for development and testing
- No external dependencies required
- Configurable memory limits and indexing
- Automatic cleanup and garbage collection options

#### Configuration

**Environment Variables**
Add these to your `.env` file to configure knowledge graph functionality:

```bash
# Enable knowledge graph functionality
KNOWLEDGE_GRAPH_ENABLED=true

# Backend configuration
KNOWLEDGE_GRAPH_TYPE=neo4j              # or 'in-memory'

# Neo4j configuration (if using Neo4j backend)
KNOWLEDGE_GRAPH_HOST=localhost
KNOWLEDGE_GRAPH_PORT=7687
KNOWLEDGE_GRAPH_URI=bolt://localhost:7687    # Alternative to host/port
KNOWLEDGE_GRAPH_USERNAME=neo4j
KNOWLEDGE_GRAPH_PASSWORD=your_password
KNOWLEDGE_GRAPH_DATABASE=neo4j

# In-memory configuration (if using in-memory backend)
# No additional configuration required - uses sensible defaults
```

#### Backend Setup

**Neo4j Setup:**

1. **Install Neo4j**: Download from [neo4j.com](https://neo4j.com/download/)
2. **Start Neo4j**: Run Neo4j Desktop or server
3. **Create Database**: Set up your knowledge graph database
4. **Configure Authentication**: Set username/password
5. **Environment Variables**: Configure connection details in `.env`

```bash
# Example Neo4j configuration
KNOWLEDGE_GRAPH_ENABLED=true
KNOWLEDGE_GRAPH_TYPE=neo4j
KNOWLEDGE_GRAPH_HOST=localhost
KNOWLEDGE_GRAPH_PORT=7687
KNOWLEDGE_GRAPH_USERNAME=neo4j
KNOWLEDGE_GRAPH_PASSWORD=your_secure_password
KNOWLEDGE_GRAPH_DATABASE=knowledge
```

## LLM Providers

Cipher supports multiple LLM providers for maximum flexibility:

- **OpenAI**: Direct API integration for GPT models (`gpt-4.1`, `04-mini`, etc.)
- **Anthropic**: Native Claude API support (`claude-4-sonnet`, `claude-4-opus`, etc.)
- **OpenRouter**: Access to 200+ models from multiple providers through a single API
- **Ollama**: Self-hosted local models with no API costs (`qwen3:8b`, `llama3.1:8b`, `mistral:7b`, etc.) - **No API key required**

### OpenRouter Integration

OpenRouter provides access to a vast ecosystem of AI models through one unified API:

#### Supported Model Providers

- **OpenAI**: `openai/gpt-4.1`, `openai/gpt-4.1-mini`
- **Anthropic**: `anthropic/claude-4-sonnet`, `anthropic/claude-3.5-haiku`
- **Google**: `google/gemini-pro-2.5`
- **Meta**: `meta-llama/llama-3.1-8b-instruct`, `meta-llama/llama-3.1-70b-instruct`
- **Mistral**: `mistralai/mistral-7b-instruct`, `mistralai/mixtral-8x7b-instruct`
- **And 200+ more models**

#### Benefits of OpenRouter

- **Single API Key**: Access hundreds of models with one API key
- **Cost Optimization**: Choose the most cost-effective model for your use case
- **Model Diversity**: Access models from different providers without multiple integrations
- **Fallback Options**: Switch between models seamlessly if one is unavailable
- **Latest Models**: Access to cutting-edge models as soon as they're released

### Ollama Integration

Ollama enables you to run large language models locally on your machine for complete privacy and control:

We recommend these models that work great with tool calling:

**🚀 Best Performance** (if you have powerful hardware):
**DeepSeek-R1** and **Qwen3** are currently the top performers. DeepSeek-R1 offers GPT-4 level reasoning, while Qwen3 has excellent tool support across different sizes.

**🔥 High Performance** (good balance):
**Llama 3.1** and **Llama 3.3** from Meta are solid choices with great tool calling. **Hermes3** is fantastic for conversation, and **Qwen2.5** handles multiple languages really well.

**💡 For Coding**:
**Qwen2.5-Coder** is specifically designed for code generation and debugging. **DeepSeek Coder** and **Devstral** are also excellent coding assistants.

**🏃‍♂️ If you want something lightweight**:
**Phi4-Mini** from Microsoft is surprisingly capable for its size, and **Granite** from IBM offers good efficiency.

Pick any model from these families - start with smaller sizes like 8B or 14B if you're not sure about your hardware, then upgrade to 32B or 70B for better performance once you know what works.

#### Setup Instructions

1. **Install Ollama**: Download from [ollama.com](https://ollama.com)
2. **Choose & Pull a Model** (based on your hardware):

   ```bash
   # For high-end hardware (32GB+ VRAM)
   ollama pull qwen3:32b           # or llama3.1:70b

   # For mid-range hardware (8-16GB VRAM)
   ollama pull qwen3:8b            # or llama3.1:8b

   # For resource-constrained hardware (4GB VRAM)
   ollama pull phi4-mini:3.8b      # or granite3.3:2b
   ```

3. **Set Environment**: `OLLAMA_BASE_URL=http://localhost:11434/v1`
4. **Configure Cipher**: Use `provider: ollama` in your `cipher.yml`
5. **Check Model Status**: `ollama list` to verify your model is available

#### Configuration Examples

**For High Performance (if you have good hardware):**

```yaml
llm:
  provider: ollama
  model: qwen3:32b # 32B model for excellent performance
  baseURL: $OLLAMA_BASE_URL # Points to your local Ollama instance
  maxIterations: 50 # For agentic tool calling loops
```

**For Maximum Performance (requires high-end hardware):**

```yaml
llm:
  provider: ollama
  model: llama3.1:70b # 70B model for best results
  baseURL: $OLLAMA_BASE_URL # Points to your local Ollama instance
  maxIterations: 50 # For agentic tool calling loops
```

**For Balanced Performance/Resources:**

```yaml
llm:
  provider: ollama
  model: qwen3:8b # 8B model for good balance
  baseURL: $OLLAMA_BASE_URL # Points to your local Ollama instance
  maxIterations: 50 # For agentic tool calling loops
```

## Contributing

We welcome contributions! Refer to our [Contributing Guide](./CONTRIBUTING.md) for more details.

## Community & Support

Join our [Discord](https://discord.com/invite/UMRrpNjh5W) to chat with the community and get support.

If you're enjoying this project, please give us a ⭐ on GitHub!

## License

[Elastic License 2.0](LICENSE)
