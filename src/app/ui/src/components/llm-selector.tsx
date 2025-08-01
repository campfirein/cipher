"use client"

import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { 
  Settings,
  ChevronDown,
  ChevronUp,
  Loader2,
  AlertCircle,
  CheckCircle,
  Key,
  Globe,
  Zap
} from "lucide-react"
import { cn } from "@/lib/utils"
import { LLMProvider, LLMConfig, LLMSwitchRequest } from "@/types/server-registry"

interface LLMSelectorProps {
  isOpen: boolean
  onClose: () => void
  currentSessionId?: string
  onConfigChange?: (config: LLMConfig) => void
}

export function LLMSelector({ isOpen, onClose, currentSessionId, onConfigChange }: LLMSelectorProps) {
  // State management
  const [providers, setProviders] = React.useState<Record<string, LLMProvider>>({})
  const [currentConfig, setCurrentConfig] = React.useState<LLMConfig | null>(null)
  const [selectedProvider, setSelectedProvider] = React.useState<string>('')
  const [selectedModel, setSelectedModel] = React.useState<string>('')
  const [selectedRouter, setSelectedRouter] = React.useState<string>('vercel')
  const [apiKey, setApiKey] = React.useState<string>('')
  const [baseURL, setBaseURL] = React.useState<string>('')
  const [showAdvanced, setShowAdvanced] = React.useState(false)
  const [isLoading, setIsLoading] = React.useState(false)
  const [isSwitching, setIsSwitching] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [success, setSuccess] = React.useState<string | null>(null)
  const [hasExistingApiKey, setHasExistingApiKey] = React.useState<boolean>(false)

  // Base URL validation logic
  const validateBaseURL = (url: string): { isValid: boolean; error?: string } => {
    if (!url.trim()) {
      return { isValid: true } // Empty URL is valid (optional field)
    }

    try {
      const parsedUrl = new URL(url)

      // Check if protocol is http or https
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        return {
          isValid: false,
          error: 'URL must use http:// or https:// protocol'
        }
      }

      // Check if URL includes '/v1' for OpenAI compatibility
      if (!parsedUrl.pathname.includes('/v1')) {
        return {
          isValid: false,
          error: 'URL must include "/v1" path for OpenAI compatibility'
        }
      }

      return { isValid: true }
    } catch (error) {
      return {
        isValid: false,
        error: 'Invalid URL format'
      }
    }
  }

  // Data fetching logic
  React.useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true)
      try {
        const [currentRes, providersRes] = await Promise.all([
          fetch('/api/llm/current'),
          fetch('/api/llm/providers')
        ])

        if (currentRes.ok) {
          const current = await currentRes.json()
          setCurrentConfig(current)
          setHasExistingApiKey(!!current.config.apiKey)
        }

        if (providersRes.ok) {
          const providersData = await providersRes.json()
          setProviders(providersData.providers)
        }
      } catch (err) {
        console.error('Failed to fetch LLM data:', err)
        setError('Failed to load LLM configuration')
      } finally {
        setIsLoading(false)
      }
    }

    fetchData()
  }, [])

  // Form reset logic
  React.useEffect(() => {
    if (isOpen && currentConfig) {
      setSelectedProvider(currentConfig.config.provider)
      setSelectedModel(currentConfig.config.model)
      setSelectedRouter(currentConfig.serviceInfo.router || 'vercel')

      // Keep existing apiKey value instead of resetting to empty
      if (!hasExistingApiKey) {
        setApiKey('')
      }

      setBaseURL(currentConfig.config.baseURL || '')
      setShowAdvanced(false)
      setError(null)
      setSuccess(null)
    }
  }, [isOpen, currentConfig, hasExistingApiKey])

  // Dependent field management
  React.useEffect(() => {
    if (selectedProvider) {
      setSelectedModel('') // Reset model when provider changes

      // Auto-select appropriate router if current one isn't supported
      const provider = providers[selectedProvider]
      if (provider && !provider.supportedRouters.includes(selectedRouter)) {
        setSelectedRouter(provider.supportedRouters[0] || 'vercel')
      }

      // Clear baseURL if provider doesn't support it
      if (provider && !provider.supportsBaseURL) {
        setBaseURL('')
      }
    }
  }, [selectedProvider, providers, selectedRouter])

  // Error handling logic
  const handleSwitchError = (result: any) => {
    if (result.errors && result.errors.length > 0) {
      const primaryError = result.errors[0]
      let errorMessage = primaryError.message

      // For API key errors, show the suggested action
      if (primaryError.type === 'missing_api_key' && primaryError.suggestedAction) {
        errorMessage += `. ${primaryError.suggestedAction}`
      }

      setError(errorMessage)
    } else {
      // Fallback to old format or generic error
      setError(result.error || 'Failed to switch LLM')
    }
  }

  // Model switch handler
  const handleSwitch = async () => {
    if (!selectedProvider || !selectedModel || !selectedRouter) {
      setError('Please select provider, model, and router')
      return
    }

    // Validate baseURL if provided
    if (baseURL) {
      const urlValidation = validateBaseURL(baseURL)
      if (!urlValidation.isValid) {
        setError(urlValidation.error || 'Invalid base URL')
        return
      }
    }

    setIsSwitching(true)
    setError(null)
    setSuccess(null)

    try {
      const requestBody: LLMSwitchRequest = {
        provider: selectedProvider,
        model: selectedModel,
        router: selectedRouter
      }

      if (apiKey) requestBody.apiKey = apiKey
      if (baseURL) requestBody.baseURL = baseURL
      if (currentSessionId) requestBody.sessionId = currentSessionId

      const response = await fetch('/api/llm/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      })

      const result = await response.json()

      if (result.success) {
        setCurrentConfig(result.config)
        setSuccess(result.message)
        onConfigChange?.(result.config)
        
        setTimeout(() => {
          onClose()
          setSuccess(null)
        }, 1500)
      } else {
        handleSwitchError(result)
      }
    } catch (err) {
      setError('Network error while switching LLM')
    } finally {
      setIsSwitching(false)
    }
  }

  // Helper functions
  const getCurrentDisplayName = () => {
    if (!currentConfig) return 'Loading...'
    const provider = providers[currentConfig.config.provider]
    return `${provider?.name || currentConfig.config.provider} / ${currentConfig.config.model}`
  }

  const getAvailableRouters = () => {
    if (!selectedProvider || !providers[selectedProvider]) return []
    return providers[selectedProvider].supportedRouters
  }

  const supportsBaseURL = () => {
    return selectedProvider && providers[selectedProvider]?.supportsBaseURL
  }

  const hasRouterChoice = () => {
    return getAvailableRouters().length > 1
  }

  const getSelectedProviderModels = () => {
    if (!selectedProvider || !providers[selectedProvider]) return []
    return providers[selectedProvider].models
  }

  if (isLoading) {
    return (
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-w-md">
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-muted-foreground">Loading LLM configuration...</span>
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5" />
            LLM Model Selector
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Current configuration display */}
          <div className="bg-muted/50 rounded-lg p-3">
            <p className="text-sm font-medium mb-1">Current Configuration</p>
            <p className="text-sm text-muted-foreground">{getCurrentDisplayName()}</p>
          </div>

          {/* Error/Success messages */}
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {success && (
            <Alert className="border-green-200 bg-green-50">
              <CheckCircle className="h-4 w-4 text-green-600" />
              <AlertDescription className="text-green-800">{success}</AlertDescription>
            </Alert>
          )}

          {/* Provider selection */}
          <div>
            <label className="text-sm font-medium mb-2 block">Provider *</label>
            <Select
              value={selectedProvider}
              onValueChange={setSelectedProvider}
              disabled={isSwitching}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a provider" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(providers).map(([key, provider]) => (
                  <SelectItem key={key} value={key}>
                    <div className="flex items-center gap-2">
                      <Zap className="w-4 h-4" />
                      {provider.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Model selection */}
          <div>
            <label className="text-sm font-medium mb-2 block">Model *</label>
            <Select
              value={selectedModel}
              onValueChange={setSelectedModel}
              disabled={!selectedProvider || isSwitching}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a model" />
              </SelectTrigger>
              <SelectContent>
                {getSelectedProviderModels().map((model) => (
                  <SelectItem key={model} value={model}>
                    {model}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Router selection (only show if multiple options) */}
          {hasRouterChoice() && (
            <div>
              <label className="text-sm font-medium mb-2 block">Router *</label>
              <Select
                value={selectedRouter}
                onValueChange={setSelectedRouter}
                disabled={isSwitching}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {getAvailableRouters().map((router) => (
                    <SelectItem key={router} value={router}>
                      <div className="flex items-center gap-2">
                        <Globe className="w-4 h-4" />
                        {router}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Advanced options toggle */}
          <Button
            type="button"
            variant="ghost"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="w-full justify-between"
            disabled={isSwitching}
          >
            <span>Advanced Options</span>
            {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </Button>

          {/* Advanced options */}
          {showAdvanced && (
            <div className="space-y-4 border-t pt-4">
              {/* API Key */}
              <div>
                <label className="text-sm font-medium mb-2 block flex items-center gap-2">
                  <Key className="w-4 h-4" />
                  API Key
                  {hasExistingApiKey && (
                    <span className="text-xs text-muted-foreground">(leave empty to keep existing)</span>
                  )}
                </label>
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={hasExistingApiKey ? "Enter new API key (optional)" : "Enter API key"}
                  disabled={isSwitching}
                />
              </div>

              {/* Base URL (only show if provider supports it) */}
              {supportsBaseURL() && (
                <div>
                  <label className="text-sm font-medium mb-2 block flex items-center gap-2">
                    <Globe className="w-4 h-4" />
                    Base URL
                  </label>
                  <Input
                    value={baseURL}
                    onChange={(e) => setBaseURL(e.target.value)}
                    placeholder="https://api.example.com/v1"
                    disabled={isSwitching}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Custom API endpoint (must include /v1 path)
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={isSwitching}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSwitch}
            disabled={!selectedProvider || !selectedModel || !selectedRouter || isSwitching}
          >
            {isSwitching ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Switching...
              </>
            ) : (
              'Switch Model'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}