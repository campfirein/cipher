"use client"

import * as React from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { useChatStatus } from "@/components"
import { getWebSocketUrl } from "@/lib/chat-config"

export function ConfigPanel() {
  const { status, websocket } = useChatStatus();
  const [wsUrl, setWsUrl] = React.useState(() => getWebSocketUrl());
  const [customUrl, setCustomUrl] = React.useState('');

  const currentUrl = websocket?.url || wsUrl;

  const handleUpdateUrl = () => {
    if (customUrl.trim()) {
      setWsUrl(customUrl.trim());
      // In a real app, you'd need to reconnect with the new URL
      console.log('WebSocket URL updated:', customUrl.trim());
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
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">WebSocket Configuration</CardTitle>
        <CardDescription>
          Configure the WebSocket connection for real-time chat
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Connection Status</Label>
          <div className="flex items-center space-x-2">
            <div className={`w-3 h-3 rounded-full ${getStatusColor(status)}`} />
            <Badge variant="outline" className="text-sm">
              {status.toUpperCase()}
            </Badge>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Current WebSocket URL</Label>
          <div className="p-3 bg-muted rounded-md font-mono text-sm break-all">
            {currentUrl}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="custom-url">Custom WebSocket URL</Label>
          <div className="flex space-x-2">
            <Input
              id="custom-url"
              value={customUrl}
              onChange={(e) => setCustomUrl(e.target.value)}
              placeholder="ws://localhost:3001"
              className="font-mono"
            />
            <Button
              onClick={handleUpdateUrl}
              disabled={!customUrl.trim()}
              size="sm"
            >
              Update
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Note: Changing the URL requires a page refresh to take effect
          </p>
        </div>

        <div className="pt-4 border-t">
          <h4 className="font-medium mb-2">Environment Variables</h4>
          <div className="space-y-1 text-sm text-muted-foreground">
            <div>
              <code className="bg-muted px-2 py-1 rounded">NEXT_PUBLIC_WS_URL</code>
              <span className="ml-2">Default WebSocket URL</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}