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
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { KeyValueEditor, KeyValuePair } from "@/components/ui/key-value-editor"
import { generateId } from "@/lib/utils"
import { ServerRegistryEntry, ServerCategory, ServerType, ServerPlatform } from "@/types/server-registry"

interface AddCustomServerModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (server: ServerRegistryEntry) => Promise<void>
}

const createEmptyKeyValuePair = (): KeyValuePair => ({
  key: '',
  value: '',
  id: generateId()
})

export function AddCustomServerModal({ open, onOpenChange, onSubmit }: AddCustomServerModalProps) {
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [formData, setFormData] = React.useState<Partial<ServerRegistryEntry>>({
    name: '',
    description: '',
    category: 'custom',
    icon: '',
    version: '1.0.0',
    author: '',
    homepage: '',
    config: {
      type: 'stdio',
      command: '',
      args: [],
      url: '',
      env: {},
      headers: {},
      timeout: 30000,
    },
    tags: [],
    isInstalled: false,
    requirements: {
      platform: 'all',
      node: '',
      python: '',
      dependencies: [],
    },
  })

  // Input states for parsed fields
  const [argsInput, setArgsInput] = React.useState('')
  const [tagsInput, setTagsInput] = React.useState('')
  const [envInput, setEnvInput] = React.useState('')
  const [dependenciesInput, setDependenciesInput] = React.useState('')
  const [headers, setHeaders] = React.useState<KeyValuePair[]>([createEmptyKeyValuePair()])

  const [errors, setErrors] = React.useState<Record<string, string>>({})

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      category: 'custom',
      icon: '',
      version: '1.0.0',
      author: '',
      homepage: '',
      config: {
        type: 'stdio',
        command: '',
        args: [],
        url: '',
        env: {},
        headers: {},
        timeout: 30000,
      },
      tags: [],
      isInstalled: false,
      requirements: {
        platform: 'all',
        node: '',
        python: '',
        dependencies: [],
      },
    })
    setArgsInput('')
    setTagsInput('')
    setEnvInput('')
    setDependenciesInput('')
    setHeaders([createEmptyKeyValuePair()])
    setErrors({})
  }

  const updateFormData = (field: keyof ServerRegistryEntry, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const updateConfigData = (field: keyof ServerRegistryEntry['config'], value: any) => {
    setFormData(prev => ({
      ...prev,
      config: { ...prev.config!, [field]: value }
    }))
  }

  const updateRequirementsData = (field: string, value: any) => {
    setFormData(prev => ({
      ...prev,
      requirements: { ...prev.requirements!, [field]: value }
    }))
  }

  const parseCommaSeparated = (input: string): string[] => {
    return input.split(',').map(s => s.trim()).filter(Boolean)
  }

  const parseEnvironmentVariables = (input: string): Record<string, string> => {
    const env: Record<string, string> = {}
    const envLines = input.split('\n')
    
    for (const line of envLines) {
      const trimmedLine = line.trim()
      if (!trimmedLine) continue

      const equalIndex = trimmedLine.indexOf('=')
      if (equalIndex > 0) {
        const key = trimmedLine.substring(0, equalIndex).trim()
        const value = trimmedLine.substring(equalIndex + 1).trim()
        if (key) env[key] = value
      }
    }
    
    return env
  }

  const parseHeaders = (pairs: KeyValuePair[]): Record<string, string> => {
    const result: Record<string, string> = {}
    pairs.forEach(pair => {
      if (pair.key.trim() && pair.value.trim()) {
        result[pair.key.trim()] = pair.value.trim()
      }
    })
    return result
  }

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {}

    if (!formData.name?.trim()) {
      newErrors.name = 'Name is required'
    }

    if (!formData.description?.trim()) {
      newErrors.description = 'Description is required'
    }

    if (formData.config?.type === 'stdio') {
      if (!formData.config.command?.trim()) {
        newErrors.command = 'Command is required for stdio servers'
      }
    } else if (formData.config?.type === 'sse' || formData.config?.type === 'streamable-http') {
      if (!formData.config.url?.trim()) {
        newErrors.url = 'URL is required for SSE/HTTP servers'
      }
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!validateForm()) return

    setIsSubmitting(true)
    try {
      const serverEntry: ServerRegistryEntry = {
        ...formData,
        id: formData.id || `custom-${Date.now()}`,
        name: formData.name!,
        description: formData.description!,
        category: formData.category!,
        icon: formData.icon || '🔧',
        version: formData.version || '1.0.0',
        author: formData.author || '',
        homepage: formData.homepage || '',
        config: {
          ...formData.config!,
          args: parseCommaSeparated(argsInput),
          env: parseEnvironmentVariables(envInput),
          headers: parseHeaders(headers),
        },
        tags: parseCommaSeparated(tagsInput),
        isInstalled: false,
        isOfficial: false,
        lastUpdated: new Date(),
        requirements: {
          ...formData.requirements!,
          dependencies: parseCommaSeparated(dependenciesInput),
        },
      }

      await onSubmit(serverEntry)
      resetForm()
      onOpenChange(false)
    } catch (error) {
      console.error('Failed to add server:', error)
    } finally {
      setIsSubmitting(false)
    }
  }

  const isStdioType = formData.config?.type === 'stdio'
  const isUrlType = formData.config?.type === 'sse' || formData.config?.type === 'streamable-http'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Custom MCP Server</DialogTitle>
          <DialogDescription>
            Configure a new MCP server with its connection details and metadata.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Basic Information */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium">Basic Information</h3>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Name *</label>
                <Input
                  value={formData.name || ''}
                  onChange={(e) => updateFormData('name', e.target.value)}
                  placeholder="My Custom Server"
                  className={errors.name ? 'border-red-500' : ''}
                />
                {errors.name && <p className="text-sm text-red-500 mt-1">{errors.name}</p>}
              </div>

              <div>
                <label className="text-sm font-medium">Version</label>
                <Input
                  value={formData.version || ''}
                  onChange={(e) => updateFormData('version', e.target.value)}
                  placeholder="1.0.0"
                />
              </div>
            </div>

            <div>
              <label className="text-sm font-medium">Description *</label>
              <Textarea
                value={formData.description || ''}
                onChange={(e) => updateFormData('description', e.target.value)}
                placeholder="Brief description of what this server does"
                className={errors.description ? 'border-red-500' : ''}
              />
              {errors.description && <p className="text-sm text-red-500 mt-1">{errors.description}</p>}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Category</label>
                <Select value={formData.category} onValueChange={(value: ServerCategory) => updateFormData('category', value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="productivity">Productivity</SelectItem>
                    <SelectItem value="development">Development</SelectItem>
                    <SelectItem value="research">Research</SelectItem>
                    <SelectItem value="data">Data</SelectItem>
                    <SelectItem value="communication">Communication</SelectItem>
                    <SelectItem value="custom">Custom</SelectItem>
                  </SelectContent>  
                </Select>
              </div>

              <div>
                <label className="text-sm font-medium">Icon</label>
                <Input
                  value={formData.icon || ''}
                  onChange={(e) => updateFormData('icon', e.target.value)}
                  placeholder="🔧"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Author</label>
                <Input
                  value={formData.author || ''}
                  onChange={(e) => updateFormData('author', e.target.value)}
                  placeholder="Your Name"
                />
              </div>

              <div>
                <label className="text-sm font-medium">Homepage</label>
                <Input
                  value={formData.homepage || ''}
                  onChange={(e) => updateFormData('homepage', e.target.value)}
                  placeholder="https://github.com/user/repo"
                />
              </div>
            </div>
          </div>

          {/* Server Configuration */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium">Server Configuration</h3>
            
            <div>
              <label className="text-sm font-medium">Server Type</label>
              <Select value={formData.config?.type} onValueChange={(value: ServerType) => updateConfigData('type', value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="stdio">Standard I/O (Local Process)</SelectItem>
                  <SelectItem value="sse">Server-Sent Events</SelectItem>
                  <SelectItem value="streamable-http">Streamable HTTP</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {isStdioType && (
              <>
                <div>
                  <label className="text-sm font-medium">Command *</label>
                  <Input
                    value={formData.config?.command || ''}
                    onChange={(e) => updateConfigData('command', e.target.value)}
                    placeholder="node"
                    className={errors.command ? 'border-red-500' : ''}
                  />
                  {errors.command && <p className="text-sm text-red-500 mt-1">{errors.command}</p>}
                </div>

                <div>
                  <label className="text-sm font-medium">Arguments</label>
                  <Input
                    value={argsInput}
                    onChange={(e) => setArgsInput(e.target.value)}
                    placeholder="server.js, --port=3000"
                  />
                  <p className="text-xs text-muted-foreground mt-1">Comma-separated arguments</p>
                </div>

                <div>
                  <label className="text-sm font-medium">Environment Variables</label>
                  <Textarea
                    value={envInput}
                    onChange={(e) => setEnvInput(e.target.value)}
                    placeholder="API_KEY=your_key&#10;DEBUG=true"
                    rows={3}
                  />
                  <p className="text-xs text-muted-foreground mt-1">KEY=value format, one per line</p>
                </div>
              </>
            )}

            {isUrlType && (
              <>
                <div>
                  <label className="text-sm font-medium">URL *</label>
                  <Input
                    value={formData.config?.url || ''}
                    onChange={(e) => updateConfigData('url', e.target.value)}
                    placeholder="https://api.example.com/mcp"
                    className={errors.url ? 'border-red-500' : ''}
                  />
                  {errors.url && <p className="text-sm text-red-500 mt-1">{errors.url}</p>}
                </div>

                <div>
                  <label className="text-sm font-medium">Headers</label>
                  <KeyValueEditor
                    pairs={headers}
                    onChange={setHeaders}
                    placeholder={{ key: "Authorization", value: "Bearer token" }}
                  />
                </div>
              </>
            )}

            <div>
              <label className="text-sm font-medium">Timeout (ms)</label>
              <Input
                type="number"
                value={formData.config?.timeout || 30000}
                onChange={(e) => updateConfigData('timeout', parseInt(e.target.value) || 30000)}
                placeholder="30000"
              />
            </div>
          </div>

          {/* Requirements */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium">Requirements</h3>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Platform</label>
                <Select value={formData.requirements?.platform} onValueChange={(value: ServerPlatform) => updateRequirementsData('platform', value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Platforms</SelectItem>
                    <SelectItem value="darwin">macOS</SelectItem>
                    <SelectItem value="linux">Linux</SelectItem>
                    <SelectItem value="win32">Windows</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm font-medium">Node Version</label>
                <Input
                  value={formData.requirements?.node || ''}
                  onChange={(e) => updateRequirementsData('node', e.target.value)}
                  placeholder=">=18.0.0"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Python Version</label>
                <Input
                  value={formData.requirements?.python || ''}
                  onChange={(e) => updateRequirementsData('python', e.target.value)}
                  placeholder=">=3.8"
                />
              </div>

              <div>
                <label className="text-sm font-medium">Dependencies</label>
                <Input
                  value={dependenciesInput}
                  onChange={(e) => setDependenciesInput(e.target.value)}
                  placeholder="numpy, pandas"
                />
                <p className="text-xs text-muted-foreground mt-1">Comma-separated packages</p>
              </div>
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className="text-sm font-medium">Tags</label>
            <Input
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="api, database, utility"
            />
            <p className="text-xs text-muted-foreground mt-1">Comma-separated tags</p>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Adding...' : 'Add Server'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}