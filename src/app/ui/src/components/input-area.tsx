"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
// import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select" // Temporarily disabled
import { Alert, AlertDescription } from "@/components/ui/alert"
import { 
  Send, 
  Image as ImageIcon, 
  X, 
  AlertCircle,
  // Loader2 // Temporarily disabled
} from "lucide-react"
import { ImageData, Model } from "@/types/server-registry"

interface InputAreaProps {
  onSend: (text: string, imageData?: ImageData) => void
  // currentSessionId?: string // Temporarily disabled - will be used for LLM switching later
  disabled?: boolean
  placeholder?: string
  // models?: Model[] // Temporarily disabled - will be used for LLM switching later
}

const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB

// Default models for demo purposes
const defaultModels: Model[] = [
  { name: "GPT-4.1-mini", provider: "openai", model: "gpt-4.1-mini" },

]

export function InputArea({ 
  onSend, 
  // currentSessionId, // Temporarily disabled
  disabled = false, 
  placeholder = "Type your message...",
  // models = defaultModels // Temporarily disabled
}: InputAreaProps) {
  // State management
  const [text, setText] = React.useState('')
  const [imageData, setImageData] = React.useState<ImageData | null>(null)
  // Temporarily disabled - model selector will be developed later
  // const [currentModel, setCurrentModel] = React.useState('Loading...')
  // const [isLoadingModel, setIsLoadingModel] = React.useState(false)
  // const [modelSwitchError, setModelSwitchError] = React.useState<string | null>(null)
  const [fileUploadError, setFileUploadError] = React.useState<string | null>(null)

  // Refs for file inputs
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  // Auto-resizing textarea logic
  const adjustTextareaHeight = React.useCallback(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      const scrollHeight = textareaRef.current.scrollHeight
      const maxHeight = 120 // Maximum height in pixels
      textareaRef.current.style.height = `${Math.min(scrollHeight, maxHeight)}px`
      textareaRef.current.style.overflowY = scrollHeight > maxHeight ? 'auto' : 'hidden'
    }
  }, [])

  React.useEffect(() => {
    adjustTextareaHeight()
  }, [text, adjustTextareaHeight])


  // Error handling with auto-clear
  const showUserError = (message: string) => {
    setFileUploadError(message)
    setTimeout(() => setFileUploadError(null), 5000)
  }

  // Clear errors when user starts typing
  React.useEffect(() => {
    if (text && fileUploadError) {
      // setModelSwitchError(null) // Temporarily disabled
      setFileUploadError(null)
    }
  }, [text, fileUploadError]) // Removed modelSwitchError from dependencies

  // Generic file processing
  const processFile = (
    file: File,
    validationFn: (file: File) => { isValid: boolean; error?: string },
    callback: (imageData: ImageData) => void
  ) => {
    // File size validation
    if (file.size > MAX_FILE_SIZE) {
      showUserError('File too large. Maximum size is 50MB.')
      return
    }

    const validation = validationFn(file)
    if (!validation.isValid) {
      showUserError(validation.error || 'Invalid file type.')
      return
    }

    const reader = new FileReader()
    reader.onloadend = () => {
      try {
        const result = reader.result as string
        const commaIndex = result.indexOf(',')
        const base64 = result.substring(commaIndex + 1)

        callback({
          base64,
          mimeType: file.type
        } as ImageData)

        setFileUploadError(null)
      } catch (error) {
        showUserError('Failed to process file. Please try again.')
      }
    }
    reader.onerror = () => {
      showUserError('Failed to read file. Please try again.')
    }
    reader.readAsDataURL(file)
  }

  // Image upload validation
  const validateImage = (file: File) => {
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']
    return {
      isValid: validTypes.includes(file.type),
      error: validTypes.includes(file.type) ? undefined : 'Please select a valid image file (JPEG, PNG, GIF, WebP)'
    }
  }



  // File upload handlers
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      processFile(file, validateImage, (data) => {
        setImageData(data as ImageData)
      })
    }
    e.target.value = '' // Reset input
  }




  // Model switching logic - Temporarily disabled (will be developed later)
  /*
  const handleModelSwitch = async (model: Model) => {
    setIsLoadingModel(true)
    setModelSwitchError(null)

    try {
      const requestBody = {
        provider: model.provider,
        model: model.model,
        router: 'vercel',
        ...(currentSessionId && { sessionId: currentSessionId })
      }

      const response = await fetch('/api/llm/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      })

      const result = await response.json()

      if (result.success) {
        setCurrentModel(model.name)
        setModelSwitchError(null)
      } else {
        setModelSwitchError(result.error || 'Failed to switch model')
      }
    } catch (error) {
      setModelSwitchError('Network error while switching model')
    } finally {
      setIsLoadingModel(false)
    }
  }
  */

  // Current model fetching - Temporarily disabled (will be developed later)
  /*
  React.useEffect(() => {
    const fetchCurrentModel = async () => {
      try {
        const url = currentSessionId
          ? `/api/llm/current?sessionId=${currentSessionId}`
          : '/api/llm/current'

        const response = await fetch(url)
        if (response.ok) {
          const config = await response.json()
          // Handle the correct API response structure: data.llmConfig
          const llmConfig = config.data?.llmConfig
          
          if (llmConfig) {
            const matchedModel = models.find(m => m.model === llmConfig.model)

            setCurrentModel(matchedModel
              ? matchedModel.name
              : `${llmConfig.provider}/${llmConfig.model}`
            )
          } else {
            console.warn('Unexpected API response structure:', config)
            setCurrentModel('Unknown')
          }
        }
      } catch (error) {
        console.error('Failed to fetch current model:', error)
        setCurrentModel('Unknown')
      }
    }

    fetchCurrentModel()
  }, [currentSessionId, models])
  */

  // Send handler logic
  const handleSend = () => {
    const trimmed = text.trim()
    // Allow sending if we have text OR image
    if (!trimmed && !imageData) return

    onSend(trimmed, imageData ?? undefined)

    // Reset state
    setText('')
    setImageData(null)

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.overflowY = 'hidden'
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }


  const canSend = (text.trim() || imageData) && !disabled
  const hasAttachments = imageData

  return (
    <div className="border rounded-lg bg-background">
      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleImageUpload}
        className="hidden"
      />

      {/* Error messages */}
      {fileUploadError && (
        <div className="p-3 border-b">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {fileUploadError}
            </AlertDescription>
          </Alert>
        </div>
      )}

      {/* Model selector - Temporarily removed (will be developed later) */}
      {/*
      <div className="flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Model:</span>
          <Select
            value={currentModel}
            onValueChange={(modelName) => {
              const model = models.find(m => m.name === modelName)
              if (model) handleModelSwitch(model)
            }}
            disabled={isLoadingModel || disabled}
          >
            <SelectTrigger className="w-48">
              <SelectValue>
                {isLoadingModel ? (
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Switching...</span>
                  </div>
                ) : (
                  currentModel
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {models.map((model) => (
                <SelectItem key={model.model} value={model.name}>
                  {model.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      */}

      {/* Attachment previews */}
      {hasAttachments && (
        <div className="p-3 border-b">
          {imageData && (
            <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
              <img
                src={`data:${imageData.mimeType};base64,${imageData.base64}`}
                alt="Uploaded"
                className="w-12 h-12 object-cover rounded"
              />
              <div className="flex-1">
                <p className="text-sm font-medium">Image uploaded</p>
                <p className="text-xs text-muted-foreground">{imageData.mimeType}</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setImageData(null)}
                disabled={disabled}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          )}

        </div>
      )}

      {/* Input area */}
      <div className="p-3">
        <div className="flex gap-2">
          <div className="flex-1">
            <Textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              disabled={disabled}
              className="min-h-9 resize-none border-0 shadow-none focus-visible:ring-0 p-0"
              style={{ overflow: 'hidden' }}
            />
          </div>
          
          <div className="flex items-end gap-1">
            {/* Attachment buttons */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled}
              className="shrink-0"
              title="Upload image"
            >
              <ImageIcon className="w-4 h-4" />
            </Button>
            
            
            {/* Send button */}
            <Button
              onClick={handleSend}
              disabled={!canSend}
              size="sm"
              className="shrink-0"
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}