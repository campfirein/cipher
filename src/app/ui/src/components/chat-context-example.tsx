"use client"

import * as React from "react"
import { ChatProvider, useChatContext, useChatSession, useChatMessages, useChatStatus } from "@/contexts"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { extractTextFromContent, formatToolResult } from "@/lib/utils"

// Status indicator component
function ConnectionStatus() {
  const { status, isConnected, isConnecting, isStreaming, setStreaming } = useChatStatus();

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'open': return 'bg-green-500';
      case 'connecting': return 'bg-yellow-500';
      case 'closed': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };

  return (
    <div className="flex items-center space-x-3">
      <div className="flex items-center space-x-2">
        <div className={`w-2 h-2 rounded-full ${getStatusColor(status)}`} />
        <Badge variant="outline" className="text-xs">
          {status}
        </Badge>
      </div>
      
      <div className="flex items-center space-x-2">
        <label className="text-sm">Streaming:</label>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setStreaming(!isStreaming)}
          className={isStreaming ? 'bg-blue-100' : ''}
        >
          {isStreaming ? 'On' : 'Off'}
        </Button>
      </div>
    </div>
  );
}

// Session management component
function SessionManager() {
  const { currentSessionId, isWelcomeState, returnToWelcome, switchSession } = useChatSession();
  const [newSessionId, setNewSessionId] = React.useState('');

  const handleSwitchSession = async () => {
    if (newSessionId.trim()) {
      try {
        await switchSession(newSessionId.trim());
        setNewSessionId('');
      } catch (error) {
        console.error('Failed to switch session:', error);
      }
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Session Management</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center space-x-2">
          <span className="text-sm">Current:</span>
          {isWelcomeState ? (
            <Badge variant="secondary">Welcome State</Badge>
          ) : (
            <Badge variant="default" className="font-mono text-xs">
              {currentSessionId}
            </Badge>
          )}
        </div>
        
        <div className="flex space-x-2">
          <Input
            value={newSessionId}
            onChange={(e) => setNewSessionId(e.target.value)}
            placeholder="Enter session ID"
            className="text-xs"
          />
          <Button
            size="sm"
            onClick={handleSwitchSession}
            disabled={!newSessionId.trim()}
          >
            Switch
          </Button>
        </div>
        
        <Button
          size="sm"
          variant="outline"
          onClick={returnToWelcome}
          disabled={isWelcomeState}
        >
          Return to Welcome
        </Button>
      </CardContent>
    </Card>
  );
}

// Messages display component
function MessagesDisplay() {
  const { messages, reset, messageCount, hasMessages } = useChatMessages();

  return (
    <Card className="flex-1">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">
            Messages ({messageCount})
          </CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={reset}
            disabled={!hasMessages}
          >
            Reset
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-64">
          <div className="space-y-3">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${
                  message.role === 'user' ? 'justify-end' : 'justify-start'
                }`}
              >
                <div
                  className={`max-w-[80%] rounded-lg px-3 py-2 ${
                    message.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : message.role === 'assistant'
                      ? 'bg-muted'
                      : message.role === 'system'
                      ? 'bg-yellow-100 text-yellow-800'
                      : 'bg-blue-100 text-blue-800'
                  }`}
                >
                  <div className="text-sm">
                    {message.role === 'tool' ? (
                      <div>
                        <div className="font-medium">🔧 {message.toolName}</div>
                        {message.toolArgs && (
                          <pre className="text-xs mt-1 opacity-70">
                            {JSON.stringify(message.toolArgs, null, 2)}
                          </pre>
                        )}
                        {message.toolResult && (
                          <div className="mt-2 text-xs">
                            <div className="font-medium">Result:</div>
                            <pre className="opacity-70">
                              {formatToolResult(message.toolResult)}
                            </pre>
                          </div>
                        )}
                      </div>
                    ) : (
                      extractTextFromContent(message.content)
                    )}
                  </div>

                  <div className="flex items-center justify-between mt-1 text-xs opacity-70">
                    <span>{message.role}</span>
                    <span>
                      {new Date(message.createdAt).toLocaleTimeString()}
                    </span>
                  </div>

                  {(message.tokenCount || message.model) && (
                    <div className="mt-1 text-xs opacity-50">
                      {message.tokenCount && (
                        <span>{message.tokenCount} tokens</span>
                      )}
                      {message.tokenCount && message.model && <span> • </span>}
                      {message.model && <span>{message.model}</span>}
                    </div>
                  )}
                </div>
              </div>
            ))}
            
            {!hasMessages && (
              <div className="text-center text-muted-foreground text-sm py-8">
                No messages yet. Start a conversation!
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

// Message input component
function MessageInput() {
  const { sendMessage } = useChatContext();
  const { isConnected } = useChatStatus();
  const [inputValue, setInputValue] = React.useState('');
  const [isSending, setIsSending] = React.useState(false);

  const handleSendMessage = async () => {
    if (inputValue.trim() && isConnected && !isSending) {
      setIsSending(true);
      try {
        await sendMessage(inputValue.trim());
        setInputValue('');
      } catch (error) {
        console.error('Failed to send message:', error);
      } finally {
        setIsSending(false);
      }
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex space-x-2">
          <Input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Type a message..."
            disabled={!isConnected || isSending}
          />
          <Button
            onClick={handleSendMessage}
            disabled={!isConnected || !inputValue.trim() || isSending}
          >
            {isSending ? 'Sending...' : 'Send'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// Main chat interface
function ChatInterface() {
  return (
    <div className="p-4 space-y-4 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Chat Context Example</h1>
        <ConnectionStatus />
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <MessagesDisplay />
          <MessageInput />
        </div>
        
        <div className="space-y-4">
          <SessionManager />
        </div>
      </div>
    </div>
  );
}

// Root example component with provider
interface ChatContextExampleProps {
  wsUrl?: string;
}

export function ChatContextExample({ wsUrl }: ChatContextExampleProps) {
  return (
    <ChatProvider wsUrl={wsUrl} autoConnect={true}>
      <ChatInterface />
    </ChatProvider>
  );
}