"use client"

import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { KeyValueEditor, KeyValuePair } from "@/components/ui/key-value-editor"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { generateId } from "@/lib/utils"
import { McpServerConfig, HeaderPair } from "@/types/server-registry"

interface ConnectServerModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
}

const createEmptyHeaderPair = (): HeaderPair => ({
  key: '',
  value: '',
  id: generateId()
})

export function ConnectServerModal({ isOpen, onClose, onSuccess }: ConnectServerModalProps) {
  const [serverName, setServerName] = React.useState('')
  const [serverType, setServerType] = React.useState<'stdio' | 'sse' | 'http'>('stdio')
  const [command, setCommand] = React.useState('')
  const [args, setArgs] = React.useState('')
  const [url, setUrl] = React.useState('')
  const [headerPairs, setHeaderPairs] = React.useState<HeaderPair[]>([createEmptyHeaderPair()])
  const [error, setError] = React.useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = React.useState(false)

  // Reset form with delay when modal closes
  React.useEffect(() => {
    if (!isOpen) {
      const timer = setTimeout(() => {
        setServerName('')
        setServerType('stdio')
        setCommand('')
        setArgs('')
        setUrl('')
        setHeaderPairs([createEmptyHeaderPair()])
        setError(null)
        setIsSubmitting(false)
      }, 300) // Delay to allow modal close animation
      
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  const headersToRecord = (pairs: HeaderPair[]): Record<string, string> => {
    const headers: Record<string, string> = {}
    pairs.forEach((pair) => {
      if (pair.key.trim() && pair.value.trim()) {
        headers[pair.key.trim()] = pair.value.trim()
      }
    })
    return headers
  }

  const generateConfig = (): McpServerConfig => {
    if (serverType === 'stdio') {
      return {
        type: 'stdio',
        command: command.trim(),
        args: args.split(',').map(s => s.trim()).filter(Boolean),
        env: {},
        timeout: 30000,
        connectionMode: 'lenient',
      }
    } else if (serverType === 'sse') {
      return {
        type: 'sse',
        url: url.trim(),
        headers: headerPairs.length ? headersToRecord(headerPairs) : {},
        timeout: 30000,
        connectionMode: 'lenient',
      }
    } else { // http
      return {
        type: 'http',
        url: url.trim(),
        headers: headerPairs.length ? headersToRecord(headerPairs) : {},
        timeout: 30000,
        connectionMode: 'lenient',
      }
    }
  }

  const validateForm = (): string | null => {
    if (!serverName.trim()) {
      return 'Server name is required.'
    }

    if (serverType === 'stdio') {
      if (!command.trim()) {
        return 'Command is required for stdio servers.'
      }
    } else { // sse or http
      if (!url.trim()) {
        return `URL is required for ${serverType.toUpperCase()} servers.`
      }
      try {
        new URL(url.trim())
      } catch (_) {
        return `Invalid URL format for ${serverType.toUpperCase()} server.`
      }
    }

    return null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)

    const validationError = validateForm()
    if (validationError) {
      setError(validationError)
      setIsSubmitting(false)
      return
    }

    const config = generateConfig()

    try {
      const response = await fetch('/api/connect-server', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: serverName.trim(),
          config
        }),
      })

      const result = await response.json()

      if (!response.ok) {
        setError(result.error || `Server returned status ${response.status}`)
        setIsSubmitting(false)
        return
      }

      // Success - close modal and call success callback
      onClose()
      onSuccess?.()
    } catch (err: any) {
      setError(err.message || 'Failed to connect server')
    } finally {
      setIsSubmitting(false)
    }
  }

  const convertHeaderPairsToKeyValuePairs = (pairs: HeaderPair[]): KeyValuePair[] => {
    return pairs.map(pair => ({
      key: pair.key,
      value: pair.value,
      id: pair.id
    }))
  }

  const convertKeyValuePairsToHeaderPairs = (pairs: KeyValuePair[]): HeaderPair[] => {
    return pairs.map(pair => ({
      key: pair.key,
      value: pair.value,
      id: pair.id
    }))
  }

  const isStdioType = serverType === 'stdio'
  const isUrlType = serverType === 'sse' || serverType === 'http'

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Connect MCP Server</DialogTitle>
          <DialogDescription>
            Connect to an existing MCP server by providing its configuration details.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div>
            <label className="text-sm font-medium mb-2 block">Server Name *</label>
            <Input
              value={serverName}
              onChange={(e) => setServerName(e.target.value)}
              placeholder="my-mcp-server"
              disabled={isSubmitting}
            />
          </div>

          <div>
            <label className="text-sm font-medium mb-2 block">Server Type *</label>
            <Select
              value={serverType}
              onValueChange={(value: 'stdio' | 'sse' | 'http') => setServerType(value)}
              disabled={isSubmitting}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="stdio">Standard I/O (Local Process)</SelectItem>
                <SelectItem value="sse">Server-Sent Events</SelectItem>
                <SelectItem value="http">HTTP</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isStdioType && (
            <>
              <div>
                <label className="text-sm font-medium mb-2 block">Command *</label>
                <Input
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="node"
                  disabled={isSubmitting}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  The command to execute the MCP server
                </p>
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">Arguments</label>
                <Input
                  value={args}
                  onChange={(e) => setArgs(e.target.value)}
                  placeholder="server.js, --port=3000"
                  disabled={isSubmitting}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Comma-separated command arguments
                </p>
              </div>
            </>
          )}

          {isUrlType && (
            <>
              <div>
                <label className="text-sm font-medium mb-2 block">URL *</label>
                <Input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://api.example.com/mcp"
                  disabled={isSubmitting}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Complete URL to the MCP server endpoint
                </p>
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">Headers</label>
                <KeyValueEditor
                  pairs={convertHeaderPairsToKeyValuePairs(headerPairs)}
                  onChange={(pairs) => setHeaderPairs(convertKeyValuePairsToHeaderPairs(pairs))}
                  placeholder={{ key: "Authorization", value: "Bearer token" }}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  HTTP headers to include with requests
                </p>
              </div>
            </>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Connecting...' : 'Connect Server'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}