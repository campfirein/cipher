"use client"

import * as React from "react"
import { useChat } from "@/hooks/use-chat"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { extractTextFromContent, formatToolResult } from "@/lib/utils"

interface ChatExampleProps {
  wsUrl: string;
  sessionId?: string;
}

export function ChatExample({ wsUrl, sessionId }: ChatExampleProps) {
  const [inputValue, setInputValue] = React.useState("");

  const { 
    messages, 
    status, 
    isConnected, 
    sendMessage, 
    reset,
    connect,
    disconnect
  } = useChat(wsUrl, {
    autoConnect: true,
    onMessage: (message) => {
      console.log('New message:', message);
    },
    onError: (error) => {
      console.error('Chat error:', error);
    },
    onStatusChange: (status) => {
      console.log('Status changed:', status);
    }
  });

  const handleSendMessage = () => {
    if (inputValue.trim() && isConnected) {
      sendMessage(inputValue.trim(), undefined, undefined, sessionId);
      setInputValue("");
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'open': return 'bg-green-500';
      case 'connecting': return 'bg-yellow-500';
      case 'closed': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };

  return (
    <div className="flex flex-col h-96 border rounded-lg">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b">
        <div className="flex items-center space-x-2">
          <div className={`w-2 h-2 rounded-full ${getStatusColor(status)}`} />
          <span className="text-sm font-medium">Chat Example</span>
          <Badge variant="outline" className="text-xs">
            {status}
          </Badge>
        </div>
        <div className="flex space-x-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => isConnected ? disconnect() : connect()}
          >
            {isConnected ? 'Disconnect' : 'Connect'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => reset(sessionId)}
          >
            Reset
          </Button>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-3">
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
                {/* Message content */}
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

                {/* Message metadata */}
                <div className="flex items-center justify-between mt-1 text-xs opacity-70">
                  <span>{message.role}</span>
                  <span>
                    {new Date(message.createdAt).toLocaleTimeString()}
                  </span>
                </div>

                {/* Token count and model info */}
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
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="flex space-x-2 p-3 border-t">
        <Input
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="Type a message..."
          disabled={!isConnected}
        />
        <Button
          onClick={handleSendMessage}
          disabled={!isConnected || !inputValue.trim()}
        >
          Send
        </Button>
      </div>
    </div>
  );
}