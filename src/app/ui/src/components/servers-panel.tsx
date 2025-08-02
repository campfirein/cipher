"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
// import { AddCustomServerModal } from "@/components/modals" // Temporarily disabled
import { ServerRegistryBrowser } from "@/components/server-registry-browser"
import { 
  Server,
  Plus,
  X,
  Trash2,
  Wrench,
  ChevronDown,
  ChevronUp,
  Loader2,
  AlertCircle,
  RefreshCw,
  Zap,
  Package,
  Settings
} from "lucide-react"
import { cn } from "@/lib/utils"
import { McpServer, McpTool, ServerRegistryEntryForPanel } from "@/types/server-registry"

interface ServersPanelProps {
  isOpen?: boolean
  onClose?: () => void
  variant?: 'overlay' | 'inline'
  className?: string
}

export function ServersPanel({ 
  isOpen = true, 
  onClose, 
  variant = 'overlay',
  className 
}: ServersPanelProps) {
  // State management
  const [servers, setServers] = React.useState<McpServer[]>([])
  const [selectedServerId, setSelectedServerId] = React.useState<string | null>(null)
  const [tools, setTools] = React.useState<McpTool[]>([])
  const [isLoadingServers, setIsLoadingServers] = React.useState(false)
  const [isLoadingTools, setIsLoadingTools] = React.useState(false)
  const [serverError, setServerError] = React.useState<string | null>(null)
  const [toolsError, setToolsError] = React.useState<string | null>(null)
  const [isToolsExpanded, setIsToolsExpanded] = React.useState(false)
  const [isDeletingServer, setIsDeletingServer] = React.useState<string | null>(null)
  const [isRegistryModalOpen, setIsRegistryModalOpen] = React.useState(false)
  const [isRegistryBrowserOpen, setIsRegistryBrowserOpen] = React.useState(false)

  // Error handling logic
  const handleError = React.useCallback((message: string, area: 'servers' | 'tools' | 'delete') => {
    console.error(`ServersPanel Error (${area}):`, message)
    if (area === 'servers') setServerError(message)
    if (area === 'tools') setToolsError(message)
  }, [])

  // Server fetching with auto-selection
  const fetchServers = React.useCallback(async (signal?: AbortSignal) => {
    setIsLoadingServers(true)
    setServerError(null)
    setServers([]) // Clear existing servers
    setSelectedServerId(null) // Reset selected server
    setTools([]) // Clear tools
    setToolsError(null)

    try {
      const response = await fetch(`/api/mcp/servers`, signal ? { signal } : {})
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to fetch servers' }))
        throw new Error(errorData.message || errorData.error || `Server List: ${response.statusText}`)
      }

      const data = await response.json()
      const fetchedServers = data.data?.servers || data.servers || []
      setServers(fetchedServers)

      if (fetchedServers.length > 0) {
        // Auto-select the first connected server if available
        const firstConnected = fetchedServers.find((s: McpServer) => s.status === 'connected')
        if (firstConnected) {
          setSelectedServerId(firstConnected.id)
        } else if (fetchedServers.length > 0) {
          setSelectedServerId(fetchedServers[0].id) // Select first server if none are connected
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        handleError(err.message, 'servers')
      }
    } finally {
      if (!signal?.aborted) {
        setIsLoadingServers(false)
      }
    }
  }, [handleError])

  // Tools fetching logic
  const handleServerSelect = React.useCallback(async (serverId: string, signal?: AbortSignal) => {
    const server = servers.find(s => s.id === serverId)
    setTools([])
    setToolsError(null)

    console.log(`🔧 Fetching tools for server: ${serverId}`, { server, status: server?.status })

    if (!server || server.status !== 'connected') {
      console.warn(`Server "${server?.name || serverId}" is not connected or not found. Cannot fetch tools.`)
      return
    }

    setIsLoadingTools(true)
    try {
      const encodedServerId = encodeURIComponent(serverId)
      const url = `/api/mcp/servers/${encodedServerId}/tools`
      console.log(`🌐 Fetching tools from: ${url} (original serverId: "${serverId}")`)
      const response = await fetch(url, signal ? { signal } : {})
      console.log(`📡 Tools API response status:`, response.status, response.statusText)
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: `Failed to fetch tools for ${server.name}` }))
        throw new Error(errorData.message || errorData.error || `Tool List (${server.name}): ${response.statusText}`)
      }

      const data = await response.json()
      console.log(`📊 Tools API response for ${serverId}:`, data)
      const tools = data.data?.tools || data.tools || []
      console.log(`🔨 Extracted ${tools.length} tools for ${serverId}:`, tools.map((t: McpTool) => t.name))
      
      if (!signal?.aborted) {
        setTools(tools)
      }

      if (tools.length === 0) {
        console.log(`No tools found for server "${server.name}".`)
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        handleError(err.message, 'tools')
      }
    } finally {
      if (!signal?.aborted) {
        setIsLoadingTools(false)
      }
    }
  }, [servers, handleError])

  // Server installation logic
  const handleInstallServer = async (entry: ServerRegistryEntryForPanel) => {
    setIsRegistryModalOpen(false)

    // Prepare the config for the connect API
    const payload = {
      name: entry.name,
      transport: entry.config.type, // Map 'type' to 'transport' as expected by validation
      command: entry.config.command,
      args: entry.config.args || [],
      url: entry.config.url,
      env: entry.config.env || {},
      headers: entry.config.headers || {},
      timeout: entry.config.timeout || 30000,
    }

    try {
      console.log(`🚀 Installing server: ${entry.name}`)
      const res = await fetch('/api/connect-server', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const result = await res.json()
      if (!res.ok) {
        throw new Error(result.error || `Server returned status ${res.status}`)
      }

      console.log(`✅ Server ${entry.name} installed successfully`)
      
      // Refresh the servers list
      await fetchServers()
      
      // Auto-select the newly installed server for immediate tools display
      setSelectedServerId(entry.name)
      console.log(`🎯 Auto-selected newly installed server: ${entry.name}`)
      
    } catch (error: any) {
      console.error(`❌ Failed to install server ${entry.name}:`, error)
      handleError(error.message || 'Failed to install server', 'servers')
      // Re-throw error so ServerRegistryBrowser doesn't mark it as installed
      throw error
    }
  }

  // Server deletion logic
  const handleDeleteServer = async (serverId: string) => {
    const server = servers.find(s => s.id === serverId)
    if (!server) return

    if (!window.confirm(`Are you sure you want to remove server "${server.name}"?`)) {
      return
    }

    setIsDeletingServer(serverId)
    setServerError(null)

    try {
      const encodedServerId = encodeURIComponent(serverId)
      const response = await fetch(`/api/mcp/servers/${encodedServerId}`, { method: 'DELETE' })
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to remove server' }))
        throw new Error(errorData.message || errorData.error || `Server Removal: ${response.statusText}`)
      }

      // If this was the selected server, deselect it
      if (selectedServerId === serverId) {
        setSelectedServerId(null)
        setTools([])
      }

      // Notify other components that a server was uninstalled
      window.dispatchEvent(new CustomEvent('mcp-server-uninstalled', { 
        detail: { serverId, serverName: server.name }
      }))

      await fetchServers() // Refresh server list
    } catch (err: any) {
      handleError(err.message, 'servers')
    } finally {
      setIsDeletingServer(null)
    }
  }

  // Panel lifecycle management
  React.useEffect(() => {
    if (!isOpen) return
    const controller = new AbortController()
    fetchServers(controller.signal)
    // When panel opens, ensure no server is stuck in deleting state from a previous quick close
    setIsDeletingServer(null)
    return () => {
      controller.abort()
    }
  }, [isOpen, fetchServers])

  React.useEffect(() => {
    console.log(`🔄 selectedServerId changed to: ${selectedServerId}`)
    if (!selectedServerId) return
    const controller = new AbortController()
    handleServerSelect(selectedServerId, controller.signal)
    return () => {
      controller.abort()
    }
  }, [selectedServerId, handleServerSelect])

  // Server status indicator
  const getServerStatusColor = (status: string) => {
    switch (status) {
      case 'connected':
        return 'bg-green-500'
      case 'error':
        return 'bg-red-500'
      case 'disconnected':
        return 'bg-gray-500'
      default:
        return 'bg-yellow-500'
    }
  }

  const getServerStatusText = (status: string) => {
    switch (status) {
      case 'connected':
        return 'Connected'
      case 'error':
        return 'Error'
      case 'disconnected':
        return 'Disconnected'
      default:
        return 'Unknown'
    }
  }

  const getServerTypeIcon = (type: string) => {
    switch (type) {
      case 'stdio':
        return <Zap className="w-3 h-3" />
      case 'sse':
        return <Package className="w-3 h-3" />
      case 'streamable-http':
        return <Settings className="w-3 h-3" />
      default:
        return <Server className="w-3 h-3" />
    }
  }

  const ServerStatusIndicator = ({ status }: { status: string }) => (
    <div className={cn(
      "w-2 h-2 rounded-full flex-shrink-0",
      getServerStatusColor(status)
    )} />
  )

  // Tool parameters display
  const ToolParametersDisplay = ({ tool }: { tool: McpTool }) => {
    const properties = tool.parameters?.properties || tool.inputSchema?.properties
    return properties ? (
      <div className="flex flex-wrap gap-1 mt-2">
        {Object.keys(properties).slice(0, 3).map((param) => (
          <span
            key={param}
            className="inline-flex items-center px-2 py-1 rounded-md bg-muted text-xs font-medium"
          >
            {param}
          </span>
        ))}
        {Object.keys(properties).length > 3 && (
          <span className="text-xs text-muted-foreground">
            +{Object.keys(properties).length - 3} more
          </span>
        )}
      </div>
    ) : null
  }

  // Variant-based styling
  const getVariantClasses = (variant: 'overlay' | 'inline', isOpen: boolean) => {
    if (variant === 'overlay') {
      return cn(
        "fixed top-0 right-0 z-40 h-screen w-80 bg-card border-l border-border shadow-xl transition-transform transform flex flex-col",
        isOpen ? "translate-x-0" : "translate-x-full"
      )
    }
    return "h-full w-full flex flex-col bg-card"
  }

  const selectedServer = servers.find(s => s.id === selectedServerId)

  return (
    <div className={cn(getVariantClasses(variant, isOpen), className)}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2">
          <Server className="w-5 h-5" />
          <h2 className="font-semibold">MCP Servers</h2>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => fetchServers()}
            disabled={isLoadingServers}
          >
            <RefreshCw className={cn("w-4 h-4", isLoadingServers && "animate-spin")} />
          </Button>
          {variant === 'overlay' && onClose && (
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Error display */}
      {serverError && (
        <div className="mx-4 mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
          <div className="flex items-center gap-2 text-red-700">
            <AlertCircle className="w-4 h-4" />
            <span className="text-sm font-medium">Server Error</span>
          </div>
          <p className="text-sm text-red-600 mt-1">{serverError}</p>
        </div>
      )}

      {/* Server list */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium">Connected Servers ({servers.length})</h3>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Plus className="w-4 h-4 mr-1" />
                  Add
                  <ChevronDown className="w-3 h-3 ml-1" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setIsRegistryBrowserOpen(true)}>
                  <Package className="w-4 h-4 mr-2" />
                  Browse Registry
                </DropdownMenuItem>
                {/* Temporarily hidden - will develop later
                <DropdownMenuItem onClick={() => setIsRegistryModalOpen(true)}>
                  <Settings className="w-4 h-4 mr-2" />
                  Custom Server
                </DropdownMenuItem>
                */}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {isLoadingServers ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">Loading servers...</span>
            </div>
          ) : servers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Server className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p className="text-sm font-medium mb-1">No servers connected</p>
              <p className="text-xs">Add a server to get started</p>
            </div>
          ) : (
            <ScrollArea className="flex-1">
              <div className="space-y-2">
                {servers.map((server) => (
                  <div
                    key={server.id}
                    className={cn(
                      "p-3 rounded-lg border cursor-pointer transition-colors",
                      selectedServerId === server.id
                        ? "bg-accent border-accent-foreground/20"
                        : "bg-card hover:bg-muted/50"
                    )}
                    onClick={() => {
                      console.log(`🖱️ Server clicked: ${server.id} (${server.name})`)
                      setSelectedServerId(server.id)
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 min-w-0">
                        <ServerStatusIndicator status={server.status} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="text-sm font-medium truncate">{server.name}</p>
                            <div className="flex items-center gap-1">
                              {getServerTypeIcon(server.config?.type || 'stdio')}
                              <span className="text-xs text-muted-foreground uppercase font-mono">
                                {server.config?.type || 'stdio'}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={cn(
                              "text-xs px-1.5 py-0.5 rounded text-white font-medium",
                              getServerStatusColor(server.status)
                            )}>
                              {getServerStatusText(server.status)}
                            </span>
                            {server.lastSeen && (
                              <span className="text-xs text-muted-foreground">
                                Last seen: {new Date(server.lastSeen).toLocaleTimeString()}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDeleteServer(server.id)
                        }}
                        disabled={isDeletingServer === server.id}
                        className="h-6 w-6 p-0"
                      >
                        {isDeletingServer === server.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Trash2 className="w-3 h-3" />
                        )}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>

        {/* Tools section */}
        {selectedServer && (
          <div className="border-t p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Wrench className="w-4 h-4" />
                <h3 className="text-sm font-medium">Tools ({tools.length})</h3>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsToolsExpanded(!isToolsExpanded)}
                className="h-6 w-6 p-0"
              >
                {isToolsExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </Button>
            </div>

            {toolsError && (
              <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-600">
                <div className="flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  <span>{toolsError}</span>
                </div>
              </div>
            )}

            {isToolsExpanded && (
              <div className="space-y-2">
                {isLoadingTools ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                    <span className="ml-2 text-xs text-muted-foreground">Loading tools...</span>
                  </div>
                ) : tools.length === 0 ? (
                  <div className="text-center py-4 text-muted-foreground">
                    <Wrench className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p className="text-xs">No tools available</p>
                  </div>
                ) : (
                  <ScrollArea className="max-h-40">
                    <div className="space-y-2">
                      {tools.map((tool) => (
                        <div key={tool.name} className="p-2 bg-muted/50 rounded text-xs">
                          <div className="flex items-center gap-2 mb-1">
                            <Zap className="w-3 h-3 text-muted-foreground" />
                            <span className="font-medium">{tool.name}</span>
                          </div>
                          {tool.description && (
                            <p className="text-muted-foreground mb-1 text-xs">{tool.description}</p>
                          )}
                          <ToolParametersDisplay tool={tool} />
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Server Registry Browser */}
      <ServerRegistryBrowser
        open={isRegistryBrowserOpen}
        onOpenChange={setIsRegistryBrowserOpen}
        onInstall={async (entry, customConfig) => {
          // Convert ServerRegistryEntry to ServerRegistryEntryForPanel and install
          const panelEntry: ServerRegistryEntryForPanel = {
            id: entry.id,
            name: entry.name,
            config: customConfig || entry.config
          }
          await handleInstallServer(panelEntry)
        }}
      />

      {/* Add Server Modal - Temporarily hidden for development
      <AddCustomServerModal
        open={isRegistryModalOpen}
        onOpenChange={setIsRegistryModalOpen}
        onSubmit={async (serverEntry) => {
          // Convert ServerRegistryEntry to ServerRegistryEntryForPanel
          const panelEntry: ServerRegistryEntryForPanel = {
            id: Date.now().toString(),
            name: serverEntry.name,
            config: serverEntry.config
          }
          await handleInstallServer(panelEntry)
        }}
      />
      */}
    </div>
  )
}

// Hook for managing servers panel state
export function useServersPanel() {
  const [isOpen, setIsOpen] = React.useState(false)

  const openPanel = React.useCallback(() => {
    setIsOpen(true)
  }, [])

  const closePanel = React.useCallback(() => {
    setIsOpen(false)
  }, [])

  return {
    isOpen,
    openPanel,
    closePanel,
  }
}