"use client"

import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { 
  Search,
  MessageSquare,
  Clock,
  User,
  Bot,
  Settings,
  ChevronRight,
  Loader2,
  AlertCircle
} from "lucide-react"
import { cn } from "@/lib/utils"
import { 
  SearchResult, 
  SearchResponse, 
  SessionSearchResult, 
  SessionSearchResponse, 
  SearchMode 
} from "@/types/server-registry"

interface SearchPanelProps {
  isOpen?: boolean
  onClose?: () => void
  onNavigateToSession: (sessionId: string, messageIndex: number) => void
  variant?: 'modal' | 'inline'
  className?: string
}

export function SearchPanel({ 
  isOpen = true, 
  onClose, 
  onNavigateToSession,
  variant = 'modal',
  className 
}: SearchPanelProps) {
  // State management
  const [searchQuery, setSearchQuery] = React.useState('')
  const [searchMode, setSearchMode] = React.useState<SearchMode>('messages')
  const [messageResults, setMessageResults] = React.useState<SearchResult[]>([])
  const [sessionResults, setSessionResults] = React.useState<SessionSearchResult[]>([])
  const [isLoading, setIsLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [roleFilter, setRoleFilter] = React.useState<string>('all')
  const [sessionFilter, setSessionFilter] = React.useState<string>('')
  const [hasMore, setHasMore] = React.useState(false)
  const [total, setTotal] = React.useState(0)

  // Text highlighting logic
  const highlightText = React.useCallback((text: string, query: string) => {
    if (!query) return text

    const escapedQuery = query.replace(/[.*+?^${}()|\[\]\\]/g, '\\$&')
    const regex = new RegExp(`(${escapedQuery})`, 'gi')
    const parts = text.split(regex)

    return parts.map((part, index) =>
      regex.test(part) ? (
        <mark key={index} className="bg-yellow-200 dark:bg-yellow-800 font-medium rounded px-1">
          {part}
        </mark>
      ) : part
    )
  }, [])

  // Role-based UI helpers
  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'user':
        return <User className="w-4 h-4" />
      case 'assistant':
        return <Bot className="w-4 h-4" />
      case 'system':
        return <Settings className="w-4 h-4" />
      default:
        return <MessageSquare className="w-4 h-4" />
    }
  }

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'user':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
      case 'assistant':
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
      case 'system':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'
    }
  }

  // Date/time formatting
  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString()
  }

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  // Message search implementation
  const performMessageSearch = React.useCallback(async (query: string) => {
    const params = new URLSearchParams({
      q: query,
      limit: '20',
      offset: '0'
    })

    if (roleFilter !== 'all') {
      params.append('role', roleFilter)
    }

    if (sessionFilter) {
      params.append('sessionId', sessionFilter)
    }

    const response = await fetch(`/api/search/messages?${params}`)
    if (!response.ok) {
      throw new Error('Message search failed')
    }

    const data: SearchResponse = await response.json()
    setMessageResults(data.results)
    setTotal(data.total)
    setHasMore(data.hasMore)
  }, [roleFilter, sessionFilter])

  // Session search implementation
  const performSessionSearch = React.useCallback(async (query: string) => {
    const params = new URLSearchParams({ q: query })
    const response = await fetch(`/api/search/sessions?${params}`)
    if (!response.ok) {
      throw new Error('Session search failed')
    }

    const data: SessionSearchResponse = await response.json()
    setSessionResults(data.results)
    setTotal(data.total)
    setHasMore(data.hasMore)
  }, [])

  // Debounced search logic
  const performSearch = React.useCallback(async (query: string, mode: SearchMode) => {
    if (!query.trim()) {
      setMessageResults([])
      setSessionResults([])
      setTotal(0)
      setHasMore(false)
      setError(null)
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      if (mode === 'messages') {
        await performMessageSearch(query)
      } else {
        await performSessionSearch(query)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed')
      setMessageResults([])
      setSessionResults([])
      setTotal(0)
      setHasMore(false)
    } finally {
      setIsLoading(false)
    }
  }, [performMessageSearch, performSessionSearch])

  // Debounced search with 300ms delay
  React.useEffect(() => {
    const timeoutId = setTimeout(() => {
      performSearch(searchQuery, searchMode)
    }, 300)

    return () => clearTimeout(timeoutId)
  }, [searchQuery, searchMode, performSearch])

  // Result click handlers
  const handleResultClick = (result: SearchResult) => {
    onNavigateToSession(result.sessionId, result.messageIndex)
    onClose?.()
  }

  const handleSessionResultClick = (sessionResult: SessionSearchResult) => {
    onNavigateToSession(sessionResult.sessionId, sessionResult.firstMatch.messageIndex)
    onClose?.()
  }

  // Search mode toggle
  const SearchModeToggle = () => (
    <div className="flex gap-2">
      <Button
        variant={searchMode === 'messages' ? 'default' : 'outline'}
        size="sm"
        onClick={() => setSearchMode('messages')}
        className="flex-1"
      >
        <MessageSquare className="w-4 h-4 mr-2" />
        Messages
      </Button>
      <Button
        variant={searchMode === 'sessions' ? 'default' : 'outline'}
        size="sm"
        onClick={() => setSearchMode('sessions')}
        className="flex-1"
      >
        <Clock className="w-4 h-4 mr-2" />
        Sessions
      </Button>
    </div>
  )

  // Filter controls
  const FilterControls = () => (
    searchMode === 'messages' && (
      <div className="flex gap-2">
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-28">
            <SelectValue placeholder="Role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="user">User</SelectItem>
            <SelectItem value="assistant">Assistant</SelectItem>
            <SelectItem value="system">System</SelectItem>
          </SelectContent>
        </Select>

        <Input
          placeholder="Session ID (optional)"
          value={sessionFilter}
          onChange={(e) => setSessionFilter(e.target.value)}
          className="flex-1 text-sm"
        />
      </div>
    )
  )

  // Results summary
  const ResultsSummary = () => (
    searchQuery && (
      <div className="mb-4 text-sm text-muted-foreground">
        {total > 0 ? (
          <>Found {total} {searchMode === 'messages' ? 'messages' : 'sessions'} matching "{searchQuery}"</>
        ) : (
          <>No {searchMode === 'messages' ? 'messages' : 'sessions'} found matching "{searchQuery}"</>
        )}
      </div>
    )
  )

  // Message result card
  const MessageResultCard = ({ result, onClick }: { result: SearchResult, onClick: () => void }) => (
    <div
      className="p-3 rounded-lg border border-border/50 bg-card hover:bg-muted/50 transition-all cursor-pointer"
      onClick={onClick}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <Badge className={cn("text-xs", getRoleColor(result.message.role))}>
            {getRoleIcon(result.message.role)}
            <span className="ml-1 capitalize">{result.message.role}</span>
          </Badge>
          <span className="text-sm text-muted-foreground">
            Session: {result.sessionId.slice(0, 8)}...
          </span>
        </div>
        <ChevronRight className="w-4 h-4 text-muted-foreground" />
      </div>

      <div className="text-sm">
        {highlightText(result.context, searchQuery)}
      </div>
    </div>
  )

  // Session result card
  const SessionResultCard = ({ sessionResult, onClick }: { sessionResult: SessionSearchResult, onClick: () => void }) => (
    <div
      className="p-3 rounded-lg border border-border/50 bg-card hover:bg-muted/50 transition-all cursor-pointer"
      onClick={onClick}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-muted-foreground" />
          <span className="font-medium">
            {sessionResult.sessionId.slice(0, 12)}...
          </span>
          <Badge variant="secondary" className="text-xs">
            {sessionResult.matchCount} matches
          </Badge>
        </div>
        <ChevronRight className="w-4 h-4 text-muted-foreground" />
      </div>

      <div className="text-sm text-muted-foreground mb-2">
        {sessionResult.metadata.messageCount} messages •
        Created {formatDate(sessionResult.metadata.createdAt)} •
        Last active {formatTime(sessionResult.metadata.lastActivity)}
      </div>

      <div className="text-sm">
        {highlightText(sessionResult.firstMatch.context, searchQuery)}
      </div>
    </div>
  )

  // Main content
  const SearchContent = () => (
    <div className="space-y-4">
      {/* Search input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search messages and sessions..."
          className="pl-10"
        />
      </div>

      {/* Search mode toggle */}
      <SearchModeToggle />

      {/* Filter controls */}
      <FilterControls />

      {/* Results summary */}
      <ResultsSummary />

      {/* Error state */}
      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400">
          <AlertCircle className="w-4 h-4" />
          <span className="text-sm">{error}</span>
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">Searching...</span>
        </div>
      )}

      {/* Results */}
      {!isLoading && searchQuery && (
        <ScrollArea className="h-96">
          <div className="space-y-2">
            {searchMode === 'messages' 
              ? messageResults.map((result) => (
                  <MessageResultCard
                    key={`${result.sessionId}-${result.messageIndex}`}
                    result={result}
                    onClick={() => handleResultClick(result)}
                  />
                ))
              : sessionResults.map((sessionResult) => (
                  <SessionResultCard
                    key={sessionResult.sessionId}
                    sessionResult={sessionResult}
                    onClick={() => handleSessionResultClick(sessionResult)}
                  />
                ))
            }
          </div>
        </ScrollArea>
      )}

      {/* Empty state */}
      {!isLoading && !searchQuery && (
        <div className="text-center py-8 text-muted-foreground">
          <Search className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p className="text-lg font-medium mb-2">Search your conversations</p>
          <p className="text-sm">
            Find messages and sessions across all your conversations
          </p>
        </div>
      )}
    </div>
  )

  if (variant === 'modal') {
    return (
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose?.()}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Search className="w-5 h-5" />
              Search Panel
            </DialogTitle>
          </DialogHeader>
          <SearchContent />
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <div className={cn("p-4 border rounded-lg bg-background", className)}>
      <SearchContent />
    </div>
  )
}

// Hook for managing search panel state
export function useSearchPanel() {
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