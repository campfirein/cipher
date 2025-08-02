"use client"

import * as React from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { RefreshCw, Zap, AlertCircle } from "lucide-react"
import { cn } from "@/lib/utils"

interface LlmConfig {
  provider: string
  model: string
  maxIterations?: number
}

interface LlmModelDisplayProps {
  className?: string
}

export function LlmModelDisplay({ className }: LlmModelDisplayProps) {
  const [llmConfig, setLlmConfig] = React.useState<LlmConfig | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const fetchLlmConfig = React.useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      
      const response = await fetch('/api/llm/config')
      if (!response.ok) {
        throw new Error(`Failed to fetch LLM config: ${response.statusText}`)
      }
      
      const data = await response.json()
      if (data.success && data.data?.llmConfig) {
        setLlmConfig(data.data.llmConfig)
      } else {
        throw new Error('Invalid response format')
      }
    } catch (err) {
      console.error('Error fetching LLM config:', err)
      setError(err instanceof Error ? err.message : 'Failed to load LLM config')
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Fetch config on mount
  React.useEffect(() => {
    fetchLlmConfig()
  }, [fetchLlmConfig])

  const getProviderDisplayName = (provider: string): string => {
    const providerNames: Record<string, string> = {
      openai: 'OpenAI',
      anthropic: 'Anthropic',
      gemini: 'Gemini',
      openrouter: 'OpenRouter',
      ollama: 'Ollama',
      aws: 'AWS Bedrock',
      azure: 'Azure OpenAI',
      qwen: 'Qwen'
    }
    return providerNames[provider] || provider
  }

  const getProviderIcon = (provider: string): React.ReactNode => {
    switch (provider) {
      case 'openai':
        return <span className="text-green-600">🤖</span>
      case 'anthropic':
        return <span className="text-orange-600">🧠</span>
      case 'gemini':
        return <span className="text-blue-600">✨</span>
      case 'openrouter':
        return <span className="text-purple-600">🔀</span>
      case 'ollama':
        return <span className="text-gray-600">🦙</span>
      case 'aws':
        return <span className="text-orange-500">☁️</span>
      case 'azure':
        return <span className="text-blue-500">🌐</span>
      case 'qwen':
        return <span className="text-red-600">🔥</span>
      default:
        return <Zap className="w-3 h-3" />
    }
  }

  if (isLoading) {
    return (
      <div className={cn("flex items-center space-x-2", className)}>
        <RefreshCw className="w-3 h-3 animate-spin text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Loading...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className={cn("flex items-center space-x-2", className)}>
        <AlertCircle className="w-3 h-3 text-red-500" />
        <Button
          variant="ghost"
          size="sm"
          onClick={fetchLlmConfig}
          className="h-auto p-0 text-xs text-red-500 hover:text-red-600"
        >
          Retry
        </Button>
      </div>
    )
  }

  if (!llmConfig) {
    return (
      <div className={cn("flex items-center space-x-2", className)}>
        <AlertCircle className="w-3 h-3 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">No LLM configured</span>
      </div>
    )
  }

  return (
    <div className={cn("flex items-center space-x-2", className)}>
      <Badge 
        variant="secondary" 
        className="text-xs flex items-center gap-1 bg-muted/50 text-muted-foreground border-border/50"
      >
        {getProviderIcon(llmConfig.provider)}
        <span className="font-medium">{getProviderDisplayName(llmConfig.provider)}</span>
        <span className="text-muted-foreground/80">•</span>
        <span className="font-mono">{llmConfig.model}</span>
      </Badge>
      <Button
        variant="ghost"
        size="sm"
        onClick={fetchLlmConfig}
        className="h-auto p-1 opacity-50 hover:opacity-100 transition-opacity"
        title="Refresh LLM config"
      >
        <RefreshCw className="w-3 h-3" />
      </Button>
    </div>
  )
}