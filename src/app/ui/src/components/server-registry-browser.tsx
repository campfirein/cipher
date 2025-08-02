"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { 
  Search,
  Filter,
  Download,
  Check,
  Star,
  ExternalLink,
  Loader2,
  AlertCircle,
  Package,
  Shield,
  Clock,
  User,
  Settings
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useServerRegistry } from "@/hooks/use-server-registry"
import { ServerRegistryEntry, ServerRegistryFilter } from "@/types/server-registry"
import { ServerConfigModal } from "@/components/server-config-modal"

interface ServerRegistryBrowserProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onInstall?: (entry: ServerRegistryEntry, customConfig?: any) => Promise<void>
}

export function ServerRegistryBrowser({ 
  open, 
  onOpenChange, 
  onInstall 
}: ServerRegistryBrowserProps) {
  const {
    entries,
    isLoading,
    error,
    filter,
    categories,
    allTags,
    updateFilter,
    markAsInstalled,
    clearError,
    refreshEntries
  } = useServerRegistry({ autoLoad: true })

  const [searchQuery, setSearchQuery] = React.useState('')
  const [selectedCategory, setSelectedCategory] = React.useState<string>('')
  const [selectedTags, setSelectedTags] = React.useState<string[]>([])
  const [showInstalledOnly, setShowInstalledOnly] = React.useState(false)
  const [showOfficialOnly, setShowOfficialOnly] = React.useState(true) // Official entries shown by default
  const [isInstalling, setIsInstalling] = React.useState<string | null>(null)
  const [configModalOpen, setConfigModalOpen] = React.useState(false)
  const [selectedServerForConfig, setSelectedServerForConfig] = React.useState<ServerRegistryEntry | null>(null)

  // Update filter when search criteria change
  React.useEffect(() => {
    const newFilter: ServerRegistryFilter = {}
    
    if (searchQuery.trim()) newFilter.search = searchQuery.trim()
    if (selectedCategory) newFilter.category = selectedCategory
    if (selectedTags.length > 0) newFilter.tags = selectedTags
    if (showInstalledOnly) newFilter.installed = true
    // Only set official filter when explicitly toggled off (to show custom entries)
    if (!showOfficialOnly) newFilter.official = false

    updateFilter(newFilter)
  }, [searchQuery, selectedCategory, selectedTags, showInstalledOnly, showOfficialOnly, updateFilter])

  const handleInstall = async (entry: ServerRegistryEntry) => {
    if (entry.isInstalled || isInstalling === entry.id) return
    
    // Check if server needs configuration
    const needsConfig = needsConfiguration(entry)
    
    if (needsConfig) {
      setSelectedServerForConfig(entry)
      setConfigModalOpen(true)
      return
    }

    // Install directly if no config needed
    setIsInstalling(entry.id)
    try {
      if (onInstall) {
        await onInstall(entry, undefined)
      }
      // Only mark as installed if the installation was successful
      await markAsInstalled(entry.id)
    } catch (error) {
      console.error('Failed to install server:', error)
      // Don't mark as installed if there was an error
    } finally {
      setIsInstalling(null)
    }
  }

  const handleConfiguredInstall = async (entry: ServerRegistryEntry, customConfig?: any) => {
    setIsInstalling(entry.id)
    try {
      if (onInstall) {
        await onInstall(entry, customConfig)
      }
      // Only mark as installed if the installation was successful
      await markAsInstalled(entry.id)
    } catch (error) {
      console.error('Failed to install configured server:', error)
      // Don't mark as installed if there was an error
    } finally {
      setIsInstalling(null)
    }
  }

  const needsConfiguration = (entry: ServerRegistryEntry): boolean => {
    // Check if server has placeholder values that need user input
    if (entry.config.type === 'stdio') {
      // Check for placeholder directories/paths in args
      const hasPlaceholders = entry.config.args?.some(arg => 
        arg.includes('/path/to/') || 
        arg.includes('your-') ||
        arg === '/path/to/allowed/directory' ||
        arg === '/path/to/database.db' ||
        arg === 'postgresql://localhost/mydb' ||
        arg === '/path/to/git/repo'
      )
      
      // Check for empty env variables that need API keys
      const hasEmptyEnv = entry.config.env && Object.values(entry.config.env).some(val => val === '')
      
      return hasPlaceholders || hasEmptyEnv || false
    }
    
    if (entry.config.type === 'sse' || entry.config.type === 'streamable-http') {
      // Check for placeholder URLs or headers
      const hasPlaceholderUrl = !entry.config.url || entry.config.url.includes('example.com')
      const hasPlaceholderHeaders = entry.config.headers && Object.values(entry.config.headers).some(val => 
        val.includes('your-') || val.includes('Bearer token') || val === ''
      )
      
      return hasPlaceholderUrl || hasPlaceholderHeaders || false
    }
    
    return false
  }

  const toggleTag = (tag: string) => {
    setSelectedTags(prev => 
      prev.includes(tag) 
        ? prev.filter(t => t !== tag)
        : [...prev, tag]
    )
  }

  const clearFilters = () => {
    setSearchQuery('')
    setSelectedCategory('')
    setSelectedTags([])
    setShowInstalledOnly(false)
    setShowOfficialOnly(true) // Reset to default (official only)
  }

  const ServerCard = ({ entry }: { entry: ServerRegistryEntry }) => (
    <div className="p-4 border rounded-lg bg-card hover:bg-muted/50 transition-colors">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {entry.icon && (
            <span className="text-2xl flex-shrink-0">{entry.icon}</span>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold truncate">{entry.name}</h3>
              {entry.isOfficial && (
                <Badge variant="secondary" className="text-xs">
                  <Shield className="w-3 h-3 mr-1" />
                  Official
                </Badge>
              )}
              {entry.popularity && entry.popularity > 85 && (
                <Badge variant="outline" className="text-xs">
                  <Star className="w-3 h-3 mr-1" />
                  Popular
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground line-clamp-2 mb-2">
              {entry.description}
            </p>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              {entry.author && (
                <span className="flex items-center gap-1">
                  <User className="w-3 h-3" />
                  {entry.author}
                </span>
              )}
              {entry.version && (
                <span className="flex items-center gap-1">
                  <Package className="w-3 h-3" />
                  v{entry.version}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {entry.lastUpdated.toLocaleDateString()}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {entry.homepage && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => window.open(entry.homepage, '_blank')}
              className="h-8 w-8 p-0"
            >
              <ExternalLink className="w-3 h-3" />
            </Button>
          )}
          <Button
            onClick={() => handleInstall(entry)}
            disabled={entry.isInstalled || isInstalling === entry.id}
            size="sm"
            variant={entry.isInstalled ? "secondary" : "default"}
            className="min-w-[100px]"
          >
            {isInstalling === entry.id ? (
              <Loader2 className="w-3 h-3 animate-spin mr-1" />
            ) : entry.isInstalled ? (
              <Check className="w-3 h-3 mr-1" />
            ) : needsConfiguration(entry) ? (
              <Settings className="w-3 h-3 mr-1" />
            ) : (
              <Download className="w-3 h-3 mr-1" />
            )}
            {entry.isInstalled ? 'Installed' : needsConfiguration(entry) ? 'Configure' : 'Install'}
          </Button>
        </div>
      </div>

      {/* Tags */}
      {entry.tags && entry.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {entry.tags.slice(0, 4).map((tag) => (
            <Badge
              key={tag}
              variant="outline"
              className="text-xs cursor-pointer hover:bg-accent"
              onClick={() => toggleTag(tag)}
            >
              {tag}
            </Badge>
          ))}
          {entry.tags.length > 4 && (
            <Badge variant="outline" className="text-xs">
              +{entry.tags.length - 4} more
            </Badge>
          )}
        </div>
      )}

      {/* Category and Type */}
      <div className="flex items-center justify-between text-xs">
        <Badge variant="secondary" className="capitalize">
          {entry.category}
        </Badge>
        <span className="text-muted-foreground uppercase">
          {entry.config.type}
        </span>
      </div>
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="w-5 h-5" />
            MCP Server Registry
          </DialogTitle>
        </DialogHeader>

        {/* Search and Filters */}
        <div className="space-y-4 border-b pb-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search servers..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={refreshEntries}
              disabled={isLoading}
            >
              <Loader2 className={cn("w-4 h-4", isLoading && "animate-spin")} />
            </Button>
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            <Select value={selectedCategory || "all"} onValueChange={(value) => setSelectedCategory(value === "all" ? "" : value)}>
              <SelectTrigger className="w-32">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map((category) => (
                  <SelectItem key={category} value={category} className="capitalize">
                    {category}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              variant={showOfficialOnly ? "default" : "outline"}
              size="sm"
              onClick={() => setShowOfficialOnly(!showOfficialOnly)}
              title={showOfficialOnly ? "Showing official servers only" : "Show custom servers too"}
            >
              <Shield className="w-3 h-3 mr-1" />
              {showOfficialOnly ? "Official Only" : "Include Custom"}
            </Button>

            <Button
              variant={showInstalledOnly ? "default" : "outline"}
              size="sm"
              onClick={() => setShowInstalledOnly(!showInstalledOnly)}
            >
              <Check className="w-3 h-3 mr-1" />
              Installed
            </Button>

            {(searchQuery || selectedCategory || selectedTags.length > 0 || showInstalledOnly || !showOfficialOnly) && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                Clear Filters
              </Button>
            )}
          </div>

          {/* Selected Tags */}
          {selectedTags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              <span className="text-sm text-muted-foreground mr-2">Tags:</span>
              {selectedTags.map((tag) => (
                <Badge
                  key={tag}
                  variant="default"
                  className="text-xs cursor-pointer"
                  onClick={() => toggleTag(tag)}
                >
                  {tag} ×
                </Badge>
              ))}
            </div>
          )}
        </div>

        {/* Error Display */}
        {error && (
          <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700">
            <AlertCircle className="w-4 h-4" />
            <span className="text-sm">{error}</span>
            <Button variant="ghost" size="sm" onClick={clearError} className="ml-auto">
              Dismiss
            </Button>
          </div>
        )}

        {/* Server List */}
        <ScrollArea className="flex-1 min-h-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground mr-2" />
              <span className="text-muted-foreground">Loading servers...</span>
            </div>
          ) : entries.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Package className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p className="font-medium mb-1">No servers found</p>
              <p className="text-sm">Try adjusting your search criteria</p>
            </div>
          ) : (
            <div className="grid gap-3 p-1">
              {entries.map((entry) => (
                <ServerCard key={entry.id} entry={entry} />
              ))}
            </div>
          )}
        </ScrollArea>

        {/* Footer */}
        <div className="flex items-center justify-between pt-4 border-t text-sm text-muted-foreground">
          <span>
            {entries.length} server{entries.length !== 1 ? 's' : ''} found
          </span>
          <span>
            {entries.filter(e => e.isInstalled).length} installed
          </span>
        </div>
      </DialogContent>

      {/* Server Configuration Modal */}
      <ServerConfigModal
        open={configModalOpen}
        onOpenChange={setConfigModalOpen}
        server={selectedServerForConfig}
        onInstall={handleConfiguredInstall}
      />
    </Dialog>
  )
}