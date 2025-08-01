"use client"

import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { 
  User, 
  Bot, 
  Settings, 
  MessageSquare, 
  Search,
  Loader2,
  AlertCircle,
  Keyboard
} from "lucide-react"
import { cn } from "@/lib/utils"
import { SearchResult, SearchResponse } from "@/types/server-registry"

interface GlobalSearchModalProps {
  isOpen: boolean
  onClose: () => void
  onNavigateToSession: (sessionId: string, messageIndex: number) => void
}

export function GlobalSearchModal({ isOpen, onClose, onNavigateToSession }: GlobalSearchModalProps) {
  const [searchQuery, setSearchQuery] = React.useState('')
  const [results, setResults] = React.useState<SearchResult[]>([])
  const [isLoading, setIsLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [selectedIndex, setSelectedIndex] = React.useState(0)

  const inputRef = React.useRef<HTMLInputElement>(null)

  // Debounced search function
  const performSearch = React.useCallback(async (query: string) => {
    if (!query.trim()) {
      setResults([])
      setError(null)
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams({
        q: query,
        limit: '10',
        offset: '0'
      })

      const response = await fetch(`/api/search/messages?${params}`)
      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Search failed: ${response.status} ${errorText}`)
      }

      const data: SearchResponse = await response.json()
      setResults(data.results)
      setSelectedIndex(0)
    } catch (err) {
      console.error('Search error:', err)
      setResults([])
      setError(err instanceof Error ? err.message : 'Search failed')
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Debounced search with 300ms delay
  React.useEffect(() => {
    const timeoutId = setTimeout(() => {
      performSearch(searchQuery)
    }, 300)

    return () => clearTimeout(timeoutId)
  }, [searchQuery, performSearch])

  // Modal state reset
  React.useEffect(() => {
    if (isOpen) {
      setSearchQuery('')
      setResults([])
      setError(null)
      setSelectedIndex(0)
      // Auto-focus on input when modal opens
      setTimeout(() => {
        inputRef.current?.focus()
      }, 0)
    }
  }, [isOpen])

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

  // Role-based icons and colors
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

  // Result click handler
  const handleResultClick = (result: SearchResult) => {
    onNavigateToSession(result.sessionId, result.messageIndex)
    onClose()
  }

  // Keyboard navigation handler
  React.useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          e.stopPropagation()
          setSelectedIndex(prev => Math.min(prev + 1, results.length - 1))
          break
        case 'ArrowUp':
          e.preventDefault()
          e.stopPropagation()
          setSelectedIndex(prev => Math.max(prev - 1, 0))
          break
        case 'Enter':
          e.preventDefault()
          e.stopPropagation()
          if (results[selectedIndex]) {
            handleResultClick(results[selectedIndex])
          }
          break
        case 'Escape':
          e.preventDefault()
          e.stopPropagation()
          onClose()
          break
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, results, selectedIndex, onClose])

  const truncateSessionId = (sessionId: string) => {
    return sessionId.length > 8 ? `${sessionId.substring(0, 8)}...` : sessionId
  }

  const showEmptyState = !searchQuery.trim() && !isLoading
  const showNoResults = searchQuery.trim() && results.length === 0 && !isLoading && !error

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] p-0">
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle className="flex items-center gap-2">
            <Search className="w-5 h-5" />
            Global Search
          </DialogTitle>
        </DialogHeader>

        <div className="px-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              ref={inputRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search messages..."
              className="pl-10"
            />
          </div>
        </div>

        <ScrollArea className="flex-1 max-h-96">
          <div className="px-6 pb-6">
            {showEmptyState && (
              <div className="text-center py-8 text-muted-foreground">
                <Search className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p className="text-lg font-medium mb-2">Search your conversations</p>
                <p className="text-sm mb-4">Find messages, responses, and context across all sessions</p>
                <div className="flex items-center justify-center gap-4 text-xs">
                  <div className="flex items-center gap-1">
                    <Keyboard className="w-3 h-3" />
                    <span>↑↓ Navigate</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Keyboard className="w-3 h-3" />
                    <span>Enter Select</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Keyboard className="w-3 h-3" />
                    <span>Esc Close</span>
                  </div>
                </div>
              </div>
            )}

            {isLoading && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                <span className="ml-2 text-muted-foreground">Searching...</span>
              </div>
            )}

            {error && (
              <div className="flex items-center justify-center py-8 text-red-500">
                <AlertCircle className="w-6 h-6 mr-2" />
                <span>{error}</span>
              </div>
            )}

            {showNoResults && (
              <div className="text-center py-8 text-muted-foreground">
                <Search className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p className="text-lg font-medium mb-2">No results found</p>
                <p className="text-sm">Try different keywords or check your spelling</p>
              </div>
            )}

            {results.length > 0 && (
              <div className="space-y-2 py-4">
                {results.map((result, index) => (
                  <div
                    key={`${result.sessionId}-${result.messageIndex}`}
                    className={cn(
                      "p-4 rounded-lg border cursor-pointer transition-colors",
                      index === selectedIndex
                        ? "bg-accent border-accent-foreground/20"
                        : "bg-card hover:bg-accent/50"
                    )}
                    onClick={() => handleResultClick(result)}
                  >
                    <div className="flex items-start gap-3">
                      <div className={cn(
                        "flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium",
                        getRoleColor(result.message.role)
                      )}>
                        {getRoleIcon(result.message.role)}
                        <span className="capitalize">{result.message.role}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xs text-muted-foreground font-mono">
                            Session: {truncateSessionId(result.sessionId)}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            Message #{result.messageIndex + 1}
                          </span>
                        </div>
                        <div className="text-sm">
                          <div className="font-medium mb-1">
                            {highlightText(result.matchedText, searchQuery)}
                          </div>
                          {result.context && (
                            <div className="text-muted-foreground text-xs line-clamp-2">
                              {highlightText(result.context, searchQuery)}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}