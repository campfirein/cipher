"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { 
  Settings,
  FolderOpen,
  Key,
  Globe,
  Terminal,
  AlertCircle,
  Info,
  CheckCircle
} from "lucide-react"
import { cn } from "@/lib/utils"
import { ServerRegistryEntry } from "@/types/server-registry"

interface ServerConfigModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  server: ServerRegistryEntry | null
  onInstall: (server: ServerRegistryEntry, customConfig?: any) => Promise<void>
}

interface ConfigField {
  key: string
  label: string
  description: string
  type: 'text' | 'textarea' | 'password' | 'number'
  required: boolean
  placeholder: string
  value: string
}

export function ServerConfigModal({ 
  open, 
  onOpenChange, 
  server, 
  onInstall 
}: ServerConfigModalProps) {
  const [configFields, setConfigFields] = React.useState<ConfigField[]>([])
  const [envVars, setEnvVars] = React.useState<ConfigField[]>([])
  const [isInstalling, setIsInstalling] = React.useState(false)

  // Generate configuration fields based on server type and requirements
  React.useEffect(() => {
    if (!server) {
      setConfigFields([])
      setEnvVars([])
      return
    }

    const fields: ConfigField[] = []
    const envFields: ConfigField[] = []

    // Type-specific configuration
    if (server.config.type === 'stdio') {
      // Command configuration
      fields.push({
        key: 'command',
        label: 'Command',
        description: 'The command to execute (usually already set)',
        type: 'text',
        required: true,
        placeholder: server.config.command || 'npx',
        value: server.config.command || 'npx'
      })

      // Args configuration - handle special cases
      if (server.id === 'filesystem') {
        fields.push({
          key: 'directory',
          label: 'Allowed Directory',
          description: 'Directory path that the file system server can access (absolute path)',
          type: 'text',
          required: true,
          placeholder: '/Users/username/Documents',
          value: ''
        })
      } else if (server.id === 'sqlite') {
        fields.push({
          key: 'database',
          label: 'Database Path',
          description: 'Path to the SQLite database file',
          type: 'text',
          required: true,
          placeholder: '/path/to/database.db',
          value: ''
        })
      } else if (server.id === 'postgresql') {
        fields.push({
          key: 'connection_string',
          label: 'Connection String',
          description: 'PostgreSQL connection string',
          type: 'text',
          required: true,
          placeholder: 'postgresql://username:password@localhost:5432/database',
          value: ''
        })
      } else if (server.id === 'git') {
        fields.push({
          key: 'repository',
          label: 'Repository Path',
          description: 'Path to the Git repository',
          type: 'text',
          required: true,
          placeholder: '/path/to/git/repo',
          value: ''
        })
      }

      // Environment variables
      if (server.config.env) {
        Object.entries(server.config.env).forEach(([key, defaultValue]) => {
          if (key && defaultValue === '') {
            envFields.push({
              key,
              label: key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
              description: getEnvDescription(key),
              type: key.toLowerCase().includes('secret') || key.toLowerCase().includes('token') || key.toLowerCase().includes('key') ? 'password' : 'text',
              required: true,
              placeholder: getEnvPlaceholder(key),
              value: ''
            })
          }
        })
      }
    } else if (server.config.type === 'sse' || server.config.type === 'streamable-http') {
      fields.push({
        key: 'url',
        label: 'Server URL',
        description: 'The URL of the MCP server endpoint',
        type: 'text',
        required: true,
        placeholder: server.config.url || 'https://api.example.com/mcp',
        value: server.config.url || ''
      })

      // Headers for authentication
      if (server.config.headers) {
        Object.entries(server.config.headers).forEach(([key, defaultValue]) => {
          if (key && (defaultValue === '' || defaultValue.includes('your-'))) {
            envFields.push({
              key: `header_${key}`,
              label: `Header: ${key}`,
              description: `Value for the ${key} header`,
              type: key.toLowerCase().includes('authorization') ? 'password' : 'text',
              required: key.toLowerCase().includes('authorization'),
              placeholder: defaultValue || '',
              value: ''
            })
          }
        })
      }
    }

    setConfigFields(fields)
    setEnvVars(envFields)
  }, [server])

  const getEnvDescription = (key: string): string => {
    switch (key.toLowerCase()) {
      case 'github_personal_access_token':
        return 'GitHub Personal Access Token for repository access'
      case 'brave_search_api_key':
        return 'Brave Search API key for web searches'
      case 'slack_bot_token':
        return 'Slack Bot Token for workspace access'
      case 'google_application_credentials':
        return 'Path to Google service account credentials JSON file'
      default:
        return `Environment variable: ${key}`
    }
  }

  const getEnvPlaceholder = (key: string): string => {
    switch (key.toLowerCase()) {
      case 'github_personal_access_token':
        return 'ghp_xxxxxxxxxxxxxxxxxxxx'
      case 'brave_search_api_key':
        return 'BSA-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
      case 'slack_bot_token':
        return 'xoxb-xxxxxxxxxx-xxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxx'
      case 'google_application_credentials':
        return '/path/to/credentials.json'
      default:
        return `Enter ${key.toLowerCase()}`
    }
  }

  const updateField = (key: string, value: string, isEnv: boolean = false) => {
    if (isEnv) {
      setEnvVars(prev => prev.map(field => 
        field.key === key ? { ...field, value } : field
      ))
    } else {
      setConfigFields(prev => prev.map(field => 
        field.key === key ? { ...field, value } : field
      ))
    }
  }

  const validateFields = (): boolean => {
    const allFields = [...configFields, ...envVars]
    return allFields.every(field => !field.required || field.value.trim() !== '')
  }

  const handleInstall = async () => {
    if (!server || !validateFields()) return

    setIsInstalling(true)
    try {
      // Build custom configuration
      const customConfig = { ...server.config }

      // Apply configuration fields
      configFields.forEach(field => {
        if (field.key === 'directory' && server.id === 'filesystem') {
          // Replace the placeholder directory in args
          customConfig.args = ['-y', '@modelcontextprotocol/server-filesystem', field.value]
        } else if (field.key === 'database' && server.id === 'sqlite') {
          // Replace the placeholder database path in args
          customConfig.args = ['-y', '@modelcontextprotocol/server-sqlite', field.value]
        } else if (field.key === 'connection_string' && server.id === 'postgresql') {
          // Replace the placeholder connection string in args
          customConfig.args = ['-y', '@modelcontextprotocol/server-postgres', field.value]
        } else if (field.key === 'repository' && server.id === 'git') {
          // Replace the placeholder repository path in args
          customConfig.args = ['mcp-server-git', '--repository', field.value]
        } else if (field.key === 'url') {
          customConfig.url = field.value
        } else if (field.key === 'command') {
          customConfig.command = field.value
        }
      })

      // Apply environment variables
      const newEnv = { ...customConfig.env }
      envVars.forEach(field => {
        if (field.key.startsWith('header_')) {
          // Handle headers
          const headerKey = field.key.replace('header_', '')
          if (!customConfig.headers) customConfig.headers = {}
          customConfig.headers[headerKey] = field.value
        } else {
          // Handle environment variables
          newEnv[field.key] = field.value
        }
      })
      customConfig.env = newEnv

      const configuredServer = { ...server, config: customConfig }
      await onInstall(configuredServer, customConfig)
      onOpenChange(false)
    } catch (error) {
      console.error('Failed to install server:', error)
    } finally {
      setIsInstalling(false)
    }
  }

  if (!server) return null

  const hasRequiredFields = configFields.some(f => f.required) || envVars.some(f => f.required)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5" />
            Configure {server.name}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Server Info */}
          <div className="flex items-start gap-4 p-4 bg-muted/50 rounded-lg">
            <span className="text-2xl">{server.icon}</span>
            <div className="flex-1">
              <h3 className="font-semibold">{server.name}</h3>
              <p className="text-sm text-muted-foreground">{server.description}</p>
              <div className="flex items-center gap-2 mt-2">
                <Badge variant="secondary" className="capitalize">
                  {server.config.type}
                </Badge>
                <Badge variant="outline">
                  {server.category}
                </Badge>
              </div>
            </div>
          </div>

          {/* Information */}
          {hasRequiredFields ? (
            <div className="flex items-start gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <Info className="w-4 h-4 text-blue-600 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-blue-900">Configuration Required</p>
                <p className="text-blue-700">This server requires additional configuration before installation.</p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-3 p-3 bg-green-50 border border-green-200 rounded-lg">
              <CheckCircle className="w-4 h-4 text-green-600 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-green-900">Ready to Install</p>
                <p className="text-green-700">This server is ready to install with default configuration.</p>
              </div>
            </div>
          )}

          {/* Configuration Fields */}
          {configFields.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4" />
                <h4 className="font-medium">Server Configuration</h4>
              </div>
              
              {configFields.map((field) => (
                <div key={field.key} className="space-y-2">
                  <Label htmlFor={field.key} className="flex items-center gap-2">
                    {field.label}
                    {field.required && <span className="text-red-500">*</span>}
                  </Label>
                  <Input
                    id={field.key}
                    type={field.type}
                    value={field.value}
                    onChange={(e) => updateField(field.key, e.target.value)}
                    placeholder={field.placeholder}
                    className={cn(
                      field.required && !field.value && "border-red-300"
                    )}
                  />
                  <p className="text-xs text-muted-foreground">{field.description}</p>
                </div>
              ))}
            </div>
          )}

          {/* Environment Variables */}
          {envVars.length > 0 && (
            <>
              {configFields.length > 0 && <Separator />}
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Key className="w-4 h-4" />
                  <h4 className="font-medium">Environment Variables & Authentication</h4>
                </div>
                
                {envVars.map((field) => (
                  <div key={field.key} className="space-y-2">
                    <Label htmlFor={field.key} className="flex items-center gap-2">
                      {field.label}
                      {field.required && <span className="text-red-500">*</span>}
                    </Label>
                    {field.type === 'textarea' ? (
                      <Textarea
                        id={field.key}
                        value={field.value}
                        onChange={(e) => updateField(field.key, e.target.value, true)}
                        placeholder={field.placeholder}
                        className={cn(
                          field.required && !field.value && "border-red-300"
                        )}
                        rows={3}
                      />
                    ) : (
                      <Input
                        id={field.key}
                        type={field.type}
                        value={field.value}
                        onChange={(e) => updateField(field.key, e.target.value, true)}
                        placeholder={field.placeholder}
                        className={cn(
                          field.required && !field.value && "border-red-300"
                        )}
                      />
                    )}
                    <p className="text-xs text-muted-foreground">{field.description}</p>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Requirements Warning */}
          {server.requirements && (
            <>
              <Separator />
              <div className="space-y-2">
                <h4 className="font-medium flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" />
                  Requirements
                </h4>
                <div className="text-sm text-muted-foreground space-y-1">
                  <p>Platform: {server.requirements.platform}</p>
                  {server.requirements.node && <p>Node.js: {server.requirements.node}</p>}
                  {server.requirements.python && <p>Python: {server.requirements.python}</p>}
                  {server.requirements.dependencies && (
                    <p>Dependencies: {server.requirements.dependencies.join(', ')}</p>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isInstalling}
          >
            Cancel
          </Button>
          <Button
            onClick={handleInstall}
            disabled={isInstalling || (hasRequiredFields && !validateFields())}
          >
            {isInstalling ? 'Installing...' : 'Install Server'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}