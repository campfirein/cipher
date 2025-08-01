"use client"

import * as React from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { 
  User, 
  Bot, 
  Settings, 
  Wrench,
  ChevronDown,
  ChevronUp,
  Loader2,
  AlertTriangle,
  CheckCircle,
  FileAudio,
  FileText,
  Image as ImageIcon
} from "lucide-react"
import { cn, formatTimestamp } from "@/lib/utils"
import { Message, ContentPart } from "@/types/server-registry"

interface MessageListProps {
  messages: Message[]
  className?: string
  maxHeight?: string
}

export function MessageList({ messages, className, maxHeight = "h-96" }: MessageListProps) {
  const [manuallyExpanded, setManuallyExpanded] = React.useState<Record<string, boolean>>({})
  const endRef = React.useRef<HTMLDivElement>(null)
  const scrollAreaRef = React.useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when new messages arrive
  React.useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight
    }
  }, [messages])

  // Data URI validation for security
  function isValidDataUri(src: string): boolean {
    const dataUriRegex = /^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/i
    return dataUriRegex.test(src)
  }

  // Message classification logic
  const classifyMessage = (msg: Message, idx: number, totalMessages: number) => {
    const isUser = msg.role === 'user'
    const isAi = msg.role === 'assistant'
    const isSystem = msg.role === 'system'
    const isLastMessage = idx === totalMessages - 1
    const isToolCall = !!(msg.toolName && msg.toolArgs)
    const isToolResult = !!(msg.toolName && msg.toolResult)
    const isToolRelated = isToolCall || isToolResult

    return {
      isUser,
      isAi,
      isSystem,
      isLastMessage,
      isToolCall,
      isToolResult,
      isToolRelated
    }
  }

  // Tool expansion logic
  const getExpandedState = (msg: Message, isToolRelated: boolean, isLastMessage: boolean) => {
    return (isToolRelated && isLastMessage) || !!manuallyExpanded[msg.id]
  }

  const toggleManualExpansion = (msg: Message, isToolRelated: boolean) => {
    if (isToolRelated) {
      setManuallyExpanded(prev => ({
        ...prev,
        [msg.id]: !prev[msg.id]
      }))
    }
  }

  // Dynamic styling logic
  const getMessageContainerClass = (isUser: boolean, isSystem: boolean) => {
    return cn(
      "flex items-end w-full gap-2 mb-4",
      isUser ? "justify-end" : "justify-start",
      isSystem && "justify-center"
    )
  }

  const getBubbleClass = (role: string, isUser: boolean, isAi: boolean, isSystem: boolean) => {
    return cn(
      role === 'tool'
        ? "w-full text-muted-foreground/70 bg-secondary border border-muted/30 rounded-md text-sm p-3"
        : isUser
        ? "p-3 rounded-xl shadow-sm max-w-[75%] bg-primary text-primary-foreground rounded-br-none text-sm"
        : isAi
        ? "p-3 rounded-xl shadow-sm max-w-[75%] bg-card text-card-foreground border border-border rounded-bl-none text-sm"
        : isSystem
        ? "p-3 shadow-none w-full bg-transparent text-xs text-muted-foreground italic text-center border-none"
        : ""
    )
  }

  // Tool result type checking
  const isToolResultError = (toolResult: any) => {
    return toolResult && (toolResult.error || toolResult.isError)
  }

  const isToolResultContent = (toolResult: any) => {
    return toolResult && toolResult.content && Array.isArray(toolResult.content)
  }

  const isImagePart = (part: any) => {
    return part && (part.type === 'image' || part.base64 || part.mimeType?.startsWith('image/'))
  }

  const isTextPart = (part: any) => {
    return part && (part.type === 'text' || part.text)
  }

  const isFilePart = (part: any) => {
    return part && (part.type === 'file' || part.filename)
  }

  // Content part rendering
  const renderImagePart = (part: any, index: number) => {
    const src = part.base64 && part.mimeType
      ? `data:${part.mimeType};base64,${part.base64}`
      : part.base64

    if (src && src.startsWith('data:') && !isValidDataUri(src)) {
      return null
    }

    return (
      <img 
        key={index} 
        src={src} 
        alt="Content image" 
        className="my-1 max-h-48 w-auto rounded border border-border" 
      />
    )
  }

  const renderTextPart = (part: any, index: number) => {
    return (
      <pre key={index} className="whitespace-pre-wrap overflow-auto bg-background/50 p-2 rounded text-xs text-muted-foreground my-1">
        {part.text}
      </pre>
    )
  }

  const renderFilePart = (part: any, index: number) => {
    return (
      <div key={index} className="my-1 flex items-center gap-2 p-2 rounded border border-border bg-muted/50">
        <FileText className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">
          {part.filename || 'File attachment'} ({part.mimeType})
        </span>
      </div>
    )
  }

  const renderUnknownPart = (part: any, index: number) => {
    return (
      <pre key={index} className="whitespace-pre-wrap overflow-auto bg-muted/50 p-2 rounded text-xs my-1">
        {JSON.stringify(part, null, 2)}
      </pre>
    )
  }

  const renderGenericResult = (toolResult: any) => {
    return (
      <pre className="whitespace-pre-wrap overflow-auto bg-background/50 p-2 rounded text-xs text-muted-foreground">
        {typeof toolResult === 'object' 
          ? JSON.stringify(toolResult, null, 2) 
          : String(toolResult)}
      </pre>
    )
  }

  // Tool result rendering logic
  const renderToolResult = (toolResult: any) => {
    if (isToolResultError(toolResult)) {
      return (
        <pre className="whitespace-pre-wrap overflow-auto bg-red-100 text-red-700 p-2 rounded text-xs">
          {typeof toolResult.error === 'object'
            ? JSON.stringify(toolResult.error, null, 2)
            : String(toolResult.error)}
        </pre>
      )
    }

    if (isToolResultContent(toolResult)) {
      return toolResult.content.map((part: any, index: number) => {
        if (isImagePart(part)) {
          return renderImagePart(part, index)
        }
        if (isTextPart(part)) {
          return renderTextPart(part, index)
        }
        if (isFilePart(part)) {
          return renderFilePart(part, index)
        }
        return renderUnknownPart(part, index)
      })
    }

    return renderGenericResult(toolResult)
  }

  // Audio file rendering
  const renderAudioFile = (fileData: any, key: string) => {
    const src = `data:${fileData.mimeType};base64,${fileData.base64 || fileData.data}`

    return (
      <div key={key} className="my-2 flex items-center gap-2 p-3 rounded-lg border border-border bg-muted/50">
        <FileAudio className="h-5 w-5 text-muted-foreground" />
        <audio 
          controls 
          src={src} 
          className="flex-1 h-8"
        />
        {fileData.filename && (
          <span className="text-sm text-muted-foreground truncate max-w-[120px]">
            {fileData.filename}
          </span>
        )}
      </div>
    )
  }

  // Tool status indicators
  const getToolStatusIcon = (toolResult: any) => {
    if (!toolResult) {
      return <Loader2 className="mx-2 h-4 w-4 animate-spin text-muted-foreground" />
    }

    if (isToolResultError(toolResult)) {
      return <AlertTriangle className="mx-2 h-4 w-4 text-red-500" />
    }

    return <CheckCircle className="mx-2 h-4 w-4 text-green-500" />
  }

  // Message metadata display
  const renderMessageMetadata = (msg: Message, isAi: boolean, timestampStr: string) => {
    return (
      <div className="text-xs text-muted-foreground mt-1 px-1 flex items-center gap-2">
        <span>{timestampStr}</span>
        {isAi && msg.tokenCount && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted/50 text-xs">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
            {msg.tokenCount} tokens
          </span>
        )}
        {isAi && msg.model && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted/30 text-xs">
            {msg.model}
          </span>
        )}
      </div>
    )
  }

  // Role icon
  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'user':
        return <User className="w-4 h-4" />
      case 'assistant':
        return <Bot className="w-4 h-4" />
      case 'system':
        return <Settings className="w-4 h-4" />
      case 'tool':
        return <Wrench className="w-4 h-4" />
      default:
        return <Bot className="w-4 h-4" />
    }
  }

  // Content rendering
  const renderContent = (msg: Message) => {
    if (typeof msg.content === 'string') {
      return <div className="whitespace-pre-wrap">{msg.content}</div>
    }

    if (Array.isArray(msg.content)) {
      return msg.content.map((part: ContentPart, index: number) => {
        if (isImagePart(part)) {
          return renderImagePart(part, index)
        }
        if (isTextPart(part)) {
          return <div key={index} className="whitespace-pre-wrap">{part.text}</div>
        }
        if (isFilePart(part)) {
          return renderFilePart(part, index)
        }
        return renderUnknownPart(part, index)
      })
    }

    if (typeof msg.content === 'object') {
      return (
        <pre className="whitespace-pre-wrap overflow-auto bg-muted/50 p-2 rounded text-xs">
          {JSON.stringify(msg.content, null, 2)}
        </pre>
      )
    }

    return <div>{String(msg.content)}</div>
  }

  return (
    <ScrollArea className={cn(maxHeight, className)} ref={scrollAreaRef}>
      <div className="space-y-1 p-4">
        {messages.map((msg, idx) => {
          const {
            isUser,
            isAi,
            isSystem,
            isLastMessage,
            isToolCall,
            isToolResult,
            isToolRelated
          } = classifyMessage(msg, idx, messages.length)

          const timestampStr = formatTimestamp(msg.createdAt)
          const isExpanded = getExpandedState(msg, isToolRelated, isLastMessage)

          return (
            <div key={msg.id} className={getMessageContainerClass(isUser, isSystem)}>
              {/* Avatar */}
              {!isSystem && (
                <Avatar className="w-8 h-8 shrink-0">
                  <AvatarFallback className="text-xs">
                    {getRoleIcon(msg.role)}
                  </AvatarFallback>
                </Avatar>
              )}

              {/* Message bubble */}
              <div className="flex flex-col max-w-[75%]">
                <div className={getBubbleClass(msg.role, isUser, isAi, isSystem)}>
                  {/* Tool header */}
                  {isToolRelated && (
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Wrench className="h-4 w-4" />
                        <span className="font-medium text-sm">{msg.toolName}</span>
                        {getToolStatusIcon(msg.toolResult)}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleManualExpansion(msg, isToolRelated)}
                        className="h-6 w-6 p-0"
                      >
                        {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      </Button>
                    </div>
                  )}

                  {/* Main content */}
                  {renderContent(msg)}

                  {/* Image attachment */}
                  {msg.imageData && (
                    <div className="mt-2">
                      <img
                        src={`data:${msg.imageData.mimeType};base64,${msg.imageData.base64}`}
                        alt="Message attachment"
                        className="max-h-48 w-auto rounded border border-border"
                      />
                    </div>
                  )}

                  {/* File attachment */}
                  {msg.fileData && (
                    <div className="mt-2">
                      {msg.fileData.mimeType?.startsWith('audio/') ? (
                        renderAudioFile(msg.fileData, `audio-${msg.id}`)
                      ) : (
                        <div className="flex items-center gap-2 p-2 rounded border border-border bg-muted/50">
                          <FileText className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm text-muted-foreground">
                            {msg.fileData.filename || 'File attachment'}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Tool details (expanded) */}
                  {isToolRelated && isExpanded && (
                    <div className="mt-3 space-y-2 border-t pt-2">
                      {/* Tool arguments */}
                      {msg.toolArgs && (
                        <div>
                          <div className="text-xs font-medium mb-1">Arguments:</div>
                          <pre className="whitespace-pre-wrap overflow-auto bg-muted/50 p-2 rounded text-xs">
                            {JSON.stringify(msg.toolArgs, null, 2)}
                          </pre>
                        </div>
                      )}

                      {/* Tool result */}
                      {msg.toolResult && (
                        <div>
                          <div className="text-xs font-medium mb-1">Result:</div>
                          {renderToolResult(msg.toolResult)}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Message metadata */}
                {!isSystem && renderMessageMetadata(msg, isAi, timestampStr)}
              </div>
            </div>
          )
        })}
        
        {/* Auto-scroll anchor */}
        <div ref={endRef} />
      </div>
    </ScrollArea>
  )
}