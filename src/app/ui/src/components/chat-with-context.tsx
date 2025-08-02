"use client"

import * as React from "react"
import { ChatProvider, useChatContext } from "@/contexts"
import { Header } from "./header"
import { WelcomeScreen } from "./welcome-screen"
import { SlidingPanel } from "./sliding-panel"
import { ErrorNotification } from "./error-notification"
import { SessionPanel } from "./session-panel"
import { ServersPanel } from "./servers-panel"
import { MessageList } from "./message-list"
import { InputArea } from "./input-area"
// import { SearchPanel } from "./search-panel"
// import { GlobalSearchModal } from "./modals/global-search-modal"
import { QuickAction } from "@/types/chat"
import { convertChatMessageToMessage } from "@/lib/chat-utils"

interface ChatWithContextInnerProps {
  className?: string;
}

function ChatWithContextInner({ className }: ChatWithContextInnerProps) {
  const {
    messages,
    sendMessage,
    status,
    currentSessionId,
    switchSession,
    returnToWelcome,
    isWelcomeState,
    reset,
    isStreaming,
    setStreaming
  } = useChatContext();

  // State management for UI panels
  const [isSessionsPanelOpen, setIsSessionsPanelOpen] = React.useState(false);
  const [isServersPanelOpen, setIsServersPanelOpen] = React.useState(false);
  // const [isSearchPanelOpen, setIsSearchPanelOpen] = React.useState(false);
  // const [isGlobalSearchOpen, setIsGlobalSearchOpen] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  // Quick actions configuration
  const quickActions: QuickAction[] = [
    {
      title: "What can you do?",
      description: "See current capabilities",
      action: () => sendMessage("What tools and capabilities do you have available right now?"),
      icon: "🤔"
    },
    {
      title: "Remember",
      description: "Save a coding pattern or concept",
      action: () => sendMessage("Help me store an important programming concept, design pattern, or coding technique that I can reference later. Please ask me what concept I'd like to store and then save it with proper examples and explanations."),
      icon: "💡"
    },
    {
      title: "Connect new tools",
      description: "Browse and add MCP servers",
      action: () => setIsServersPanelOpen(true),
      icon: "🔧"
    },
    {
      title: "Test existing tools",
      description: "Try out connected capabilities",
      action: () => sendMessage("Show me how to use one of your available tools. Pick an interesting one and demonstrate it."),
      icon: "⚡"
    }
  ];

  // Enhanced send message with error handling
  const handleSend = React.useCallback(async (content: string, imageData?: any, fileData?: any) => {
    try {
      await sendMessage(content, imageData, fileData);
    } catch (error) {
      console.error("Error sending message:", error);
      setErrorMessage('Failed to send message. Please try again.');
      setTimeout(() => setErrorMessage(null), 5000);
    }
  }, [sendMessage]);

  // Session change handler with error handling
  const handleSessionChange = React.useCallback(async (sessionId: string) => {
    try {
      await switchSession(sessionId);
      setIsSessionsPanelOpen(false);
    } catch (error) {
      console.error('Error switching session:', error);
      setErrorMessage('Failed to switch session. Please try again.');
      setTimeout(() => setErrorMessage(null), 5000);
    }
  }, [switchSession]);

  // Create new session handler
  const createNewSession = React.useCallback(async () => {
    try {
      // Create a new session via API
      const response = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}), // Auto-generate session ID
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create session');
      }

      const data = await response.json();
      // Handle the API response structure
      const sessionId = data.data?.session?.id || data.session?.id;
      if (!sessionId) {
        throw new Error('Invalid session response format');
      }

      // Switch to the new session
      await switchSession(sessionId);
    } catch (error) {
      console.error('Error creating new session:', error);
      setErrorMessage('Failed to create new session. Please try again.');
      setTimeout(() => setErrorMessage(null), 5000);
    }
  }, [switchSession]);

  // Keyboard shortcuts
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.userAgent.toUpperCase().indexOf('MAC') >= 0;
      const cmdKey = isMac ? e.metaKey : e.ctrlKey;

      // Ctrl/Cmd + H to toggle sessions panel
      if (cmdKey && !e.shiftKey && e.key === 'h') {
        e.preventDefault();
        setIsSessionsPanelOpen(prev => !prev);
      }
      // Ctrl/Cmd + K to create new session
      if (cmdKey && !e.shiftKey && e.key === 'k') {
        e.preventDefault();
        createNewSession();
      }
      // Ctrl/Cmd + J to toggle tools/servers panel
      if (cmdKey && !e.shiftKey && e.key === 'j') {
        e.preventDefault();
        setIsServersPanelOpen(prev => !prev);
      }
      // Ctrl/Cmd + Shift + S to open global search
      // if (cmdKey && e.shiftKey && e.key === 'S') {
      //   e.preventDefault();
      //   setIsGlobalSearchOpen(true);
      // }
      // Escape to close panels
      if (e.key === 'Escape') {
        // if (isGlobalSearchOpen) {
        //   setIsGlobalSearchOpen(false);
        // } else if (isSearchPanelOpen) {
        //   setIsSearchPanelOpen(false);
        // } else 
        if (isServersPanelOpen) {
          setIsServersPanelOpen(false);
        } else if (isSessionsPanelOpen) {
          setIsSessionsPanelOpen(false);
        } else if (errorMessage) {
          setErrorMessage(null);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSessionsPanelOpen, isServersPanelOpen, /* isSearchPanelOpen, isGlobalSearchOpen, */ errorMessage, createNewSession]);

  // Handle navigation to search results
  // const handleNavigateToSession = React.useCallback(async (sessionId: string, messageIndex: number) => {
  //   try {
  //     // If it's a different session, switch to it
  //     if (sessionId !== currentSessionId) {
  //       await switchSession(sessionId);
  //     }
  //     // TODO: Implement scrolling to specific message index
  //     // This would require extending the MessageList component
  //     console.log(`Navigate to session ${sessionId}, message ${messageIndex}`);
  //   } catch (error) {
  //     console.error('Error navigating to search result:', error);
  //     setErrorMessage('Failed to navigate to search result');
  //     setTimeout(() => setErrorMessage(null), 5000);
  //   }
  // }, [currentSessionId, switchSession]);

  // Toggle handlers
  // const toggleSearch = () => setIsSearchPanelOpen(prev => !prev);
  const toggleSessions = () => setIsSessionsPanelOpen(prev => !prev);
  const toggleServers = () => setIsServersPanelOpen(prev => !prev);

  return (
    <div className={`flex h-screen bg-background ${className || ''}`}>
      <main className="flex-1 flex flex-col relative">
        <Header
          currentSessionId={currentSessionId}
          isWelcomeState={isWelcomeState}
          onToggleSearch={() => {}}
          onToggleSessions={toggleSessions}
          onToggleServers={toggleServers}
          isSessionsPanelOpen={isSessionsPanelOpen}
          isServersPanelOpen={isServersPanelOpen}
        />
        
        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 flex flex-col">
            {isWelcomeState ? (
              <WelcomeScreen quickActions={quickActions} />
            ) : (
              <MessageList messages={messages.map(convertChatMessageToMessage)} />
            )}
            <InputArea 
              onSend={handleSend}
              disabled={status !== 'open'}
            />
          </div>
          
          <SlidingPanel isOpen={isSessionsPanelOpen} width="w-80">
            <SessionPanel
              isOpen={isSessionsPanelOpen}
              onClose={() => setIsSessionsPanelOpen(false)}
              currentSessionId={currentSessionId}
              onSessionChange={handleSessionChange}
              returnToWelcome={returnToWelcome}
              variant="inline"
            />
          </SlidingPanel>
          
          <SlidingPanel isOpen={isServersPanelOpen} width="w-80">
            <ServersPanel
              isOpen={isServersPanelOpen}
              onClose={() => setIsServersPanelOpen(false)}
            />
          </SlidingPanel>
        </div>

        <ErrorNotification 
          message={errorMessage}
          onDismiss={() => setErrorMessage(null)}
        />

        {/* Search Components - Temporarily disabled */}
        {/* <SearchPanel
          variant="modal"
          isOpen={isSearchPanelOpen}
          onClose={() => setIsSearchPanelOpen(false)}
          onNavigateToSession={handleNavigateToSession}
        />

        <GlobalSearchModal
          isOpen={isGlobalSearchOpen}
          onClose={() => setIsGlobalSearchOpen(false)}
          onNavigateToSession={handleNavigateToSession}
        /> */}
      </main>
    </div>
  );
}

interface ChatWithContextProps {
  wsUrl?: string;
  autoConnect?: boolean;
  className?: string;
}

export function ChatWithContext({ 
  wsUrl, 
  autoConnect = true, 
  className 
}: ChatWithContextProps) {
  return (
    <ChatProvider wsUrl={wsUrl} autoConnect={autoConnect}>
      <ChatWithContextInner className={className} />
    </ChatProvider>
  );
}