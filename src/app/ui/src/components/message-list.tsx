"use client"

import * as React from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { 
  User, 
  Settings, 
  Wrench,
  ChevronDown,
  ChevronUp,
  Loader2,
  AlertTriangle,
  CheckCircle,
  FileText
} from "lucide-react"
import Image from "next/image"
import { cn, formatTimestamp } from "@/lib/utils"
import { Message, ContentPart } from "@/types/server-registry"

interface MessageListProps {
  messages: Message[]
  className?: string
  maxHeight?: string
}

export function MessageList({ messages, className, maxHeight = "h-full" }: MessageListProps) {
  const [toolResultsExpanded, setToolResultsExpanded] = React.useState<Record<string, boolean>>({})
  const [toolPanelsExpanded, setToolPanelsExpanded] = React.useState<Record<string, boolean>>({})
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
    
    // Also consider system messages with tool indicators as tool related
    const isSystemToolMessage = isSystem && msg.content !== null && msg.content !== undefined && (
      String(msg.content).includes('🔧 Using tool:') || 
      String(msg.content).includes('📋 Tool Result:') ||
      String(msg.content).includes('⏳') ||
      String(msg.content).includes('✅ Tool') ||
      String(msg.content).includes('❌ Tool')
    )
    
    const isToolRelated = isToolCall || isToolResult || isSystemToolMessage


    return {
      isUser,
      isAi,
      isSystem,
      isLastMessage,
      isToolCall,
      isToolResult,
      isToolRelated,
      isSystemToolMessage
    }
  }

  // Tool expansion logic (for detailed tool info within panels)
  const getExpandedState = (msg: Message, isToolRelated: boolean, isLastMessage: boolean) => {
    // Auto-expand tool messages with results
    if (msg.role === 'tool' && msg.toolResult) {
      return true;
    }
    // Auto-expand system tool result messages
    if (msg.role === 'system' && msg.content !== null && msg.content !== undefined && String(msg.content).includes('📋 Tool Result:')) {
      return true;
    }
    // Default to expanded for tool details within panels
    return isToolRelated && isLastMessage
  }


  const toggleToolResultExpansion = (messageId: string) => {
    setToolResultsExpanded(prev => ({
      ...prev,
      [messageId]: !prev[messageId]
    }))
  }

  const isToolResultExpanded = (messageId: string) => {
    return toolResultsExpanded[messageId] ?? true // Default to expanded
  }

  const toggleToolPanelExpansion = (messageId: string) => {
    setToolPanelsExpanded(prev => ({
      ...prev,
      [messageId]: !prev[messageId]
    }))
  }

  const isToolPanelExpanded = (messageId: string) => {
    return toolPanelsExpanded[messageId] ?? true // Default to expanded
  }

  // Dynamic styling logic
  const getMessageContainerClass = (isUser: boolean, isSystem: boolean, isToolProgress?: boolean, isSystemToolMessage?: boolean) => {
    return cn(
      "flex items-end w-full gap-2 mb-4",
      isUser ? "justify-end" : "justify-start",
      isSystem && !isToolProgress && !isSystemToolMessage && "justify-center",
      (isToolProgress || isSystemToolMessage) && "justify-start"
    )
  }

  const getBubbleClass = (role: string, isUser: boolean, isAi: boolean, isSystem: boolean, isToolProgress?: boolean, isSystemToolMessage?: boolean) => {
    return cn(
      role === 'tool'
        ? "w-full text-muted-foreground/70 bg-secondary border border-muted/30 rounded-md text-sm p-3 min-h-[2rem]"
        : isSystemToolMessage
        ? "w-full text-muted-foreground/70 bg-secondary border border-muted/30 rounded-md text-sm p-3 min-h-[2rem]"
        : isUser
        ? "p-3 rounded-xl shadow-sm max-w-[75%] bg-primary text-primary-foreground rounded-br-none text-sm"
        : isAi
        ? "p-3 rounded-xl shadow-sm max-w-[75%] bg-card text-card-foreground border border-border rounded-bl-none text-sm"
        : isSystem && isToolProgress
        ? "p-2 px-3 rounded-lg text-xs bg-secondary/50 border border-muted/30 text-muted-foreground font-mono max-w-fit"
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


  // Tool status indicators
  const getToolStatusIcon = (msg: Message, allMessages: Message[]) => {
    // For tool messages, check their own result
    if (msg.toolResult) {
      if (isToolResultError(msg.toolResult)) {
        return <AlertTriangle className="mx-2 h-4 w-4 text-red-500" />
      }
      return <CheckCircle className="mx-2 h-4 w-4 text-green-500" />
    }

    // For system tool messages, check if there's a corresponding result message
    if (msg.role === 'system' && msg.toolExecutionId) {
      const hasResult = allMessages.some(m => 
        m.role === 'system' && 
        m.toolExecutionId === msg.toolExecutionId && 
        m.content && 
        String(m.content).includes('📋 Tool Result:')
      );
      
      if (hasResult) {
        return <CheckCircle className="mx-2 h-4 w-4 text-green-500" />
      }
    }

    // Default to loading state
    return <Loader2 className="mx-2 h-4 w-4 animate-spin text-muted-foreground" />
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
        return (
          <Image 
            src="/cipher-logo.svg" 
            alt="Cipher" 
            width={16} 
            height={16} 
            className="w-4 h-4"
          />
        )
      case 'system':
        return <Settings className="w-4 h-4" />
      case 'tool':
        return <Wrench className="w-4 h-4" />
      default:
        return (
          <Image 
            src="/cipher-logo.svg" 
            alt="Cipher" 
            width={16} 
            height={16} 
            className="w-4 h-4"
          />
        )
    }
  }

  // Content rendering
  const renderContent = (msg: Message, isToolProgress?: boolean) => {
    // Handle null/undefined content for tool messages
    if (msg.content === null || msg.content === undefined) {
      // For tool messages with results, show the result or a summary
      if (msg.role === 'tool' && msg.toolResult) {
        const resultText = typeof msg.toolResult === 'string' 
          ? msg.toolResult 
          : JSON.stringify(msg.toolResult, null, 2);
        
        return (
          <div className="text-sm text-muted-foreground">
            {resultText.length > 100 
              ? `${resultText.substring(0, 100)}... (Click to view full details)`
              : resultText}
          </div>
        );
      }
      // For tool messages without results, don't render content
      if (msg.role === 'tool') {
        return null;
      }
      return <div></div>;
    }

    if (typeof msg.content === 'string') {
      // Handle empty strings for tool messages
      if (msg.role === 'tool' && msg.content === '') {
        return null;
      }
      
      // Add animation for progress messages
      if (isToolProgress && msg.content !== null && msg.content !== undefined && String(msg.content).includes('⏳')) {
        return (
          <div className="flex items-center gap-2 whitespace-pre-wrap">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>{String(msg.content).replace('⏳ ', '')}</span>
          </div>
        )
      }
      
      // Enhanced formatting for tool result messages
      if (isToolProgress && msg.content !== null && msg.content !== undefined && String(msg.content).includes('📋 Tool Result:')) {
        const [header, ...contentParts] = String(msg.content).split('\n');
        const resultContent = contentParts.join('\n');
        const isExpanded = isToolResultExpanded(msg.id);
        
        return (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="font-medium text-sm">{header}</div>
              {resultContent && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleToolResultExpansion(msg.id)}
                  className="h-6 w-6 p-0"
                >
                  {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </Button>
              )}
            </div>
            {resultContent && isExpanded && (
              <pre className="whitespace-pre-wrap overflow-auto bg-muted/30 p-3 rounded-md text-xs border border-muted/50 max-h-48">
                {resultContent}
              </pre>
            )}
            {resultContent && !isExpanded && (
              <div className="text-xs text-muted-foreground italic">
                Tool result collapsed. Click to expand.
              </div>
            )}
          </div>
        )
      }
      
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
    <ScrollArea className={cn(maxHeight, className, "flex-1 scrollbar-thin")} ref={scrollAreaRef}>
      <div className="space-y-1 p-4">
        {messages
          .filter(msg => {
            // Filter out empty messages
            if (!msg.content || 
                (typeof msg.content === 'string' && msg.content.trim() === '') ||
                (Array.isArray(msg.content) && msg.content.length === 0)) {
              return false;
            }
            return true;
          })
          .map((msg, idx) => {
          const {
            isUser,
            isAi,
            isSystem,
            isLastMessage,
            isToolRelated,
            isSystemToolMessage
          } = classifyMessage(msg, idx, messages.length)

          // Detect tool progress messages
          const isToolProgress = !!(isSystem && msg.toolExecutionId && 
            msg.content !== null && msg.content !== undefined && (
             String(msg.content).includes('🔧') || 
             String(msg.content).includes('⏳') || 
             String(msg.content).includes('✅') || 
             String(msg.content).includes('❌')))

          const timestampStr = formatTimestamp(msg.createdAt)
          const isExpanded = getExpandedState(msg, isToolRelated, isLastMessage)

          return (
            <div key={msg.id} className={getMessageContainerClass(isUser, isSystem, isToolProgress, isSystemToolMessage)}>
              {/* Avatar */}
              {!isSystem || isToolProgress || isSystemToolMessage ? (
                <Avatar className="w-8 h-8 shrink-0">
                  <AvatarFallback className="text-xs">
                    {(isToolProgress || isSystemToolMessage) ? <Wrench className="w-4 h-4" /> : getRoleIcon(msg.role)}
                  </AvatarFallback>
                </Avatar>
              ) : null}

              {/* Message bubble */}
              <div className="flex flex-col max-w-[75%]">
                <div className={getBubbleClass(msg.role, isUser, isAi, isSystem, isToolProgress, isSystemToolMessage)}>
                  {/* Tool header */}
                  {(isToolRelated || (msg.role === 'system' && msg.content !== null && msg.content !== undefined && (
                    String(msg.content).includes('🔧 Using tool:') || 
                    String(msg.content).includes('📋 Tool Result:')
                  ))) && (
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Wrench className="h-4 w-4" />
                        <span className="font-medium text-sm">
                          {msg.toolName || 
                           (msg.content !== null && msg.content !== undefined && String(msg.content).includes('🔧 Using tool:') 
                             ? String(msg.content).replace('🔧 Using tool: ', '').split('\n')[0]
                             : 'Tool Execution')}
                        </span>
                        {getToolStatusIcon(msg, messages)}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleToolPanelExpansion(msg.id)}
                        className="h-6 w-6 p-0"
                      >
                        {isToolPanelExpanded(msg.id) ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      </Button>
                    </div>
                  )}

                  {/* Tool content - only show when panel is expanded */}
                  {isToolPanelExpanded(msg.id) && (
                    <>
                      {/* Main content */}
                      {renderContent(msg, isToolProgress)}

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
                    </>
                  )}

                  {/* Collapsed state indicator */}
                  {!isToolPanelExpanded(msg.id) && (isToolRelated || isSystemToolMessage) && (
                    <div className="text-xs text-muted-foreground italic mt-2">
                      Tool details collapsed. Click to expand.
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