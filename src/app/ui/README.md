# Cipher UI

This project is an interactive web interface for the Cipher AI agent framework with real-time communication and advanced memory capabilities.

[Cipher - Memory-powered AI Agent Framework]

## Features

- **Real-time Chat**: WebSocket-powered conversation interface with live AI responses
- **Memory Integration**: Advanced memory retrieval and storage with context awareness
- **Session Management**: Persistent chat sessions with conversation history
- **MCP Integration**: Connect and manage Model Context Protocol servers and tools
- **Streaming Responses**: Token-by-token AI response streaming for natural conversation
- **Modern UI**: Clean, responsive interface built with Tailwind CSS and Radix UI

## What is Cipher?

Cipher is a memory-powered AI agent framework that provides intelligent context management and real-time communication. The UI allows you to:

- Chat with AI agents that have persistent memory
- Manage conversation sessions and history  
- Connect to MCP servers for extended tool capabilities
- Experience real-time streaming responses
- Configure LLM settings and behavior

## Quick Start

1. Start the Cipher backend server (see Developer Guide below)
2. Launch the UI development server
3. Begin chatting with memory-aware AI agents
4. Explore session management and tool integration
5. Configure LLM settings as needed

This project is built with [Next.js](https://nextjs.org) and uses modern web technologies for optimal performance.

## Developer Guide

Clear out ports 3000-3001 (linux):
```bash
lsof -ti:3000-3001 | xargs kill -9   
```

Start one server for the API at the root directory of this project [port 3001]:
```bash
[  2:29PM ]  [ ~/Projects/cipher(feat/add-ui✗) ]
 $ pnpm run build && npm link && cipher --mode server
```

then start the npm dev server [port 3000]

```bash
[  2:31PM ]  [ ~/Projects/cipher/src/app/ui(feat/add-ui✗) ]
pnpm run dev
```

Open [http://localhost:3000](http://localhost:3000) to start chatting with your AI agents.

This is temporary because the application functionality uses Cipher APIs built in the same project.

## Project Structure

```
src/
├── app/                 # Next.js app router pages
│   ├── chat/           # Chat interface page
│   ├── globals.css     # Global styles with theme
│   ├── layout.tsx      # Root layout
│   └── page.tsx        # Home page
├── components/
│   ├── chat/           # Chat-related components
│   └── ui/             # Reusable UI components (shadcn/ui style)
├── hooks/              # React hooks
│   └── use-websocket.ts # WebSocket management
├── lib/                # Utilities and clients
│   ├── api-client.ts   # HTTP API client
│   ├── utils.ts        # Utility functions
│   └── websocket-client.ts # WebSocket client
└── types/              # TypeScript type definitions
    ├── api.ts          # API response types
    └── websocket.ts    # WebSocket message types
```

## Usage

### Basic Chat

1. Navigate to `/chat`
2. The WebSocket connection will establish automatically
3. Type messages and receive real-time AI responses
4. Messages stream token-by-token for a natural conversation experience

### WebSocket Events

The interface listens for these AI events from the Cipher backend:

- `llm_response_started` - AI begins generating response
- `llm_response_chunk` - Streaming response tokens
- `llm_response_completed` - Response generation finished
- `tool_execution_started/completed` - Tool usage events
- `session_created/updated` - Session lifecycle events

## Development

### Adding Components

This project follows the shadcn/ui pattern. Components are in `src/components/ui/` and use:

- Radix UI primitives for accessibility
- `class-variance-authority` for variant styles
- `tailwind-merge` with `clsx` for conditional classes

### Customizing Theme

Edit the CSS variables in `src/app/globals.css`:

```css
@theme {
    --color-background: #0F0F0F;
    --color-primary: #099250;
    /* ... other theme variables */
}
```

### WebSocket Integration

The `useWebSocket` hook provides:

- Automatic connection management
- Event listening and message handling
- Connection status tracking
- Error handling and reconnection

## Contributing

When adding new features:

1. Follow the existing TypeScript patterns
2. Add proper type definitions
3. Use the established component patterns
4. Test WebSocket integration with the Cipher backend
5. Update this README if needed

## License

This project is part of the Cipher.
