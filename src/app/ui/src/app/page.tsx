"use client"

import { useChatContext } from "@/components";
import { Header } from "@/components/header";
import { WelcomeScreen } from "@/components/welcome-screen";
import { SlidingPanel } from "@/components/sliding-panel";
import { ErrorNotification } from "@/components/error-notification";
import { SessionPanel } from "@/components/session-panel";
import { ServersPanel } from "@/components/servers-panel";
import { CrossProjectPanel } from "@/components/cross-project-panel";
import { MessageList } from "@/components/message-list";
import { InputArea } from "@/components/input-area";
import { QuickAction } from "@/types/chat";
import { convertChatMessageToMessage } from "@/lib/chat-utils";
import { useState, useEffect } from "react";

function MainChatInterface() {
  const {
    messages,
    sendMessage,
    sendQuickActionMessage,
    status,
    currentSessionId,
    switchSession,
    returnToWelcome,
    isWelcomeState,
  } = useChatContext();

  // State management for UI panels
  const [isSessionsPanelOpen, setIsSessionsPanelOpen] = useState(false);
  const [isServersPanelOpen, setIsServersPanelOpen] = useState(false);
  const [isCrossProjectPanelOpen, setIsCrossProjectPanelOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Show session sidebar by default on page load
  useEffect(() => {
    setIsSessionsPanelOpen(true);
  }, []);

  // Quick actions configuration - now uses default session
  const quickActions: QuickAction[] = [
    {
      title: "What can you do?",
      description: "See current capabilities",
      action: async () => {
        // Ensure default session is opened before sending message
        if (isWelcomeState) {
          await switchSession('default');
        }
        sendQuickActionMessage("What tools and capabilities do you have available right now?");
      },
      icon: "🤔"
    },
    {
      title: "Remember",
      description: "Save a coding pattern or concept",
      action: async () => {
        // Ensure default session is opened before sending message
        if (isWelcomeState) {
          await switchSession('default');
        }
        sendQuickActionMessage("Help me store an important programming concept, design pattern, or coding technique that I can reference later. Please ask me what concept I'd like to store and then save it with proper examples and explanations.");
      },
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
      action: async () => {
        // Ensure default session is opened before sending message
        if (isWelcomeState) {
          await switchSession('default');
        }
        sendQuickActionMessage("Show me how to use one of your available tools. Pick an interesting one and demonstrate it.");
      },
      icon: "⚡"
    },
    {
      title: "Cross-project knowledge",
      description: "Monitor knowledge sharing across projects",
      action: () => setIsCrossProjectPanelOpen(true),
      icon: "🔄"
    }
  ];

  // Enhanced send message with error handling
  const handleSend = async (content: string, imageData?: any, fileData?: any) => {
    try {
      await sendMessage(content, imageData, fileData);
    } catch (error) {
      console.error("Error sending message:", error);
      setErrorMessage('Failed to send message. Please try again.');
      setTimeout(() => setErrorMessage(null), 5000);
    }
  };

  // Session change handler with error handling
  const handleSessionChange = async (sessionId: string) => {
    try {
      await switchSession(sessionId);
      // Don't auto-close the sessions panel - let user decide when to close it
      // setIsSessionsPanelOpen(false);
    } catch (error) {
      console.error('Error switching session:', error);
      setErrorMessage('Failed to switch session. Please try again.');
      setTimeout(() => setErrorMessage(null), 5000);
    }
  };

  // Toggle handlers
  const toggleSearch = () => {
    console.log('Search toggle - implement as needed');
  };
  const toggleSessions = () => setIsSessionsPanelOpen(prev => !prev);
  const toggleServers = () => setIsServersPanelOpen(prev => !prev);
  const toggleCrossProject = () => setIsCrossProjectPanelOpen(prev => !prev);

  return (
    <div className="flex h-screen bg-background">
      <main className="flex-1 flex flex-col relative">
        <Header
          currentSessionId={currentSessionId}
          isWelcomeState={isWelcomeState}
          onToggleSearch={toggleSearch}
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
              <MessageList 
                messages={messages.map(convertChatMessageToMessage)} 
                className="flex-1"
                maxHeight="h-full"
              />
            )}
            <div className="flex-shrink-0">
              <InputArea 
                onSend={handleSend}
                disabled={status !== 'open'}
              />
            </div>
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
          
          <CrossProjectPanel
            isOpen={isCrossProjectPanelOpen}
            onClose={() => setIsCrossProjectPanelOpen(false)}
          />
        </div>

        <ErrorNotification 
          message={errorMessage}
          onDismiss={() => setErrorMessage(null)}
        />
      </main>
    </div>
  );
}

export default function Home() {
  return <MainChatInterface />;
}