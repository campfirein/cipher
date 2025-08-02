"use client"

import * as React from "react"
import { useState, useCallback, useEffect } from "react"
import { cn } from "@/lib/utils"
import { 
  ModalStates, 
  OperationStates, 
  ExportStates, 
  QuickAction, 
  MessageData 
} from "@/types/chat"
import { Message } from "@/types/server-registry"

// Import components (to be implemented)
import { Header } from "./header"
import { WelcomeScreen } from "./welcome-screen"
import { SlidingPanel } from "./sliding-panel"
import { ErrorNotification } from "./error-notification"
import { SessionPanel } from "./session-panel"
import { ServersPanel } from "./servers-panel"
import { MessageList } from "./message-list"
import { InputArea } from "./input-area"

interface ChatProps {
  currentSessionId?: string | null;
  messages?: Message[];
  sendMessage?: (
    content: string,
    imageData?: MessageData,
    fileData?: MessageData
  ) => Promise<void>;
  switchSession?: (sessionId: string) => Promise<void>;
  returnToWelcome?: () => void;
  createNewSession?: () => Promise<void>;
}

export function Chat({
  currentSessionId,
  messages = [],
  sendMessage,
  switchSession,
  returnToWelcome,
  createNewSession
}: ChatProps) {
  // State management
  const [modalStates, setModalStates] = useState<ModalStates>({
    isModalOpen: false,
    isServerRegistryOpen: false,
    isServersPanelOpen: false,
    isSessionsPanelOpen: false,
    isExportOpen: false,
    showShortcuts: false,
    isDeleteDialogOpen: false,
  });

  const [operationStates, setOperationStates] = useState<OperationStates>({
    isSendingMessage: false,
    isDeleting: false,
    copySuccess: false,
  });

  const [exportStates, setExportStates] = useState<ExportStates>({
    exportName: 'cipher-config',
    exportError: null,
    exportContent: '',
  });

  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Derived state
  const isWelcomeState = !currentSessionId;
  const { isExportOpen, isSessionsPanelOpen, isServersPanelOpen, showShortcuts, isDeleteDialogOpen } = modalStates;
  const { isSendingMessage, copySuccess } = operationStates;
  const { exportName, exportError, exportContent } = exportStates;

  // Configuration Export Logic
  useEffect(() => {
    if (isExportOpen) {
      const exportUrl = currentSessionId
        ? `/api/config.yaml?sessionId=${currentSessionId}`
        : '/api/config.yaml';

      fetch(exportUrl)
        .then((res) => {
          if (!res.ok) throw new Error('Failed to fetch configuration');
          return res.text();
        })
        .then((text) => {
          setExportStates(prev => ({
            ...prev,
            exportContent: text,
            exportError: null
          }));
        })
        .catch((err) => {
          console.error('Preview fetch failed:', err);
          setExportStates(prev => ({
            ...prev,
            exportError: err instanceof Error ? err.message : 'Preview fetch failed'
          }));
        });
    } else {
      setExportStates(prev => ({
        ...prev,
        exportContent: '',
        exportError: null
      }));
      setOperationStates(prev => ({
        ...prev,
        copySuccess: false
      }));
    }
  }, [isExportOpen, currentSessionId]);

  // Export handlers
  const handleDownload = useCallback(async () => {
    try {
      const exportUrl = currentSessionId
        ? `/api/config.yaml?sessionId=${currentSessionId}`
        : '/api/config.yaml';

      const res = await fetch(exportUrl);
      if (!res.ok) throw new Error('Failed to fetch configuration');
      const yamlText = await res.text();
      const blob = new Blob([yamlText], { type: 'application/x-yaml' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;

      const fileName = currentSessionId
        ? `${exportName}-${currentSessionId}.yml`
        : `${exportName}.yml`;
      link.download = fileName;

      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      setModalStates(prev => ({ ...prev, isExportOpen: false }));
      setExportStates(prev => ({ ...prev, exportError: null }));
    } catch (err) {
      console.error('Export failed:', err);
      setExportStates(prev => ({
        ...prev,
        exportError: err instanceof Error ? err.message : 'Export failed'
      }));
    }
  }, [exportName, currentSessionId]);

  const handleCopy = useCallback(async () => {
    try {
      const exportUrl = currentSessionId
        ? `/api/config.yaml?sessionId=${currentSessionId}`
        : '/api/config.yaml';

      const res = await fetch(exportUrl);
      if (!res.ok) throw new Error('Failed to fetch configuration');
      const yamlText = await res.text();
      await navigator.clipboard.writeText(yamlText);
      
      setOperationStates(prev => ({ ...prev, copySuccess: true }));
      setTimeout(() => {
        setOperationStates(prev => ({ ...prev, copySuccess: false }));
      }, 2000);
      setExportStates(prev => ({ ...prev, exportError: null }));
    } catch (err) {
      console.error('Copy failed:', err);
      setExportStates(prev => ({
        ...prev,
        exportError: err instanceof Error ? err.message : 'Copy failed'
      }));
    }
  }, [currentSessionId]);

  // Message sending logic
  const handleSend = useCallback(async (
    content: string,
    imageData?: MessageData,
    fileData?: MessageData
  ) => {
    if (!sendMessage) return;
    
    setOperationStates(prev => ({ ...prev, isSendingMessage: true }));
    try {
      await sendMessage(content, imageData, fileData);
    } catch (error) {
      console.error("Error sending message:", error);
      setErrorMessage('Failed to send message. Please try again.');
      setTimeout(() => setErrorMessage(null), 5000);
    } finally {
      setOperationStates(prev => ({ ...prev, isSendingMessage: false }));
    }
  }, [sendMessage]);

  // Session management logic
  const handleSessionChange = useCallback(async (sessionId: string) => {
    if (!switchSession) return;
    
    try {
      await switchSession(sessionId);
      setModalStates(prev => ({ ...prev, isSessionsPanelOpen: false }));
    } catch (error) {
      console.error('Error switching session:', error);
      setErrorMessage('Failed to switch session. Please try again.');
      setTimeout(() => setErrorMessage(null), 5000);
    }
  }, [switchSession]);

  const handleDeleteConversation = useCallback(async () => {
    if (!currentSessionId || !returnToWelcome) return;

    setOperationStates(prev => ({ ...prev, isDeleting: true }));
    try {
      const response = await fetch(`/api/sessions/${currentSessionId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to delete conversation');
      }

      setModalStates(prev => ({ ...prev, isDeleteDialogOpen: false }));
      returnToWelcome();
    } catch (error) {
      console.error('Error deleting conversation:', error);
      setErrorMessage('Failed to delete conversation. Please try again.');
      setTimeout(() => setErrorMessage(null), 5000);
    } finally {
      setOperationStates(prev => ({ ...prev, isDeleting: false }));
    }
  }, [currentSessionId, returnToWelcome]);

  // Quick actions configuration
  const quickActions: QuickAction[] = [
    {
      title: "What can you do?",
      description: "See current capabilities",
      action: () => handleSend("What tools and capabilities do you have available right now?"),
      icon: "🤔"
    },
    {
      title: "Remember",
      description: "Save a coding pattern or concept",
      action: () => handleSend("Help me store an important programming concept, design pattern, or coding technique that I can reference later. Please ask me what concept I'd like to store and then save it with proper examples and explanations."),
      icon: "💡"
    },
    {
      title: "Connect new tools",
      description: "Browse and add MCP servers",
      action: () => setModalStates(prev => ({ ...prev, isServersPanelOpen: true })),
      icon: "🔧"
    },
    {
      title: "Test existing tools",
      description: "Try out connected capabilities",
      action: () => handleSend("Show me how to use one of your available tools. Pick an interesting one and demonstrate it."),
      icon: "⚡"
    }
  ];

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const cmdKey = isMac ? e.metaKey : e.ctrlKey;

      // Ctrl/Cmd + H to toggle sessions panel
      if (cmdKey && !e.shiftKey && e.key === 'h') {
        e.preventDefault();
        setModalStates(prev => ({ ...prev, isSessionsPanelOpen: !prev.isSessionsPanelOpen }));
      }
      // Ctrl/Cmd + K to create new session
      if (cmdKey && !e.shiftKey && e.key === 'k') {
        e.preventDefault();
        handleCreateNewSession();
      }
      // Ctrl/Cmd + J to toggle tools/servers panel
      if (cmdKey && !e.shiftKey && e.key === 'j') {
        e.preventDefault();
        setModalStates(prev => ({ ...prev, isServersPanelOpen: !prev.isServersPanelOpen }));
      }
      // Ctrl/Cmd + L to open playground
      if (cmdKey && !e.shiftKey && e.key === 'l') {
        e.preventDefault();
        window.open('/playground', '_blank');
      }
      // Ctrl/Cmd + Shift + E to export config
      if (cmdKey && e.shiftKey && e.key === 'e') {
        e.preventDefault();
        setModalStates(prev => ({ ...prev, isExportOpen: true }));
      }
      // Ctrl/Cmd + / to show shortcuts
      if (cmdKey && !e.shiftKey && e.key === '/') {
        e.preventDefault();
        setModalStates(prev => ({ ...prev, showShortcuts: true }));
      }
      // Escape to close panels
      if (e.key === 'Escape') {
        closeOpenPanels();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleCreateNewSession = async () => {
    if (!createNewSession) {
      // Fallback to API call if no createNewSession prop provided
      try {
        const response = await fetch('/api/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        const data = await response.json();
        // Handle the API response structure
        const sessionId = data.data?.session?.id || data.session?.id;
        if (!sessionId) {
          throw new Error('Invalid session response format');
        }
        await handleSessionChange(sessionId);
      } catch (error) {
        console.error('Error creating new session:', error);
        setErrorMessage('Failed to create new session. Please try again.');
        setTimeout(() => setErrorMessage(null), 5000);
      }
      return;
    }

    try {
      await createNewSession();
    } catch (error) {
      console.error('Error creating new session:', error);
      setErrorMessage('Failed to create new session. Please try again.');
      setTimeout(() => setErrorMessage(null), 5000);
    }
  };

  const closeOpenPanels = () => {
    if (isServersPanelOpen) {
      setModalStates(prev => ({ ...prev, isServersPanelOpen: false }));
    } else if (isSessionsPanelOpen) {
      setModalStates(prev => ({ ...prev, isSessionsPanelOpen: false }));
    } else if (modalStates.isServerRegistryOpen) {
      setModalStates(prev => ({ ...prev, isServerRegistryOpen: false }));
    } else if (isExportOpen) {
      setModalStates(prev => ({ ...prev, isExportOpen: false }));
    } else if (showShortcuts) {
      setModalStates(prev => ({ ...prev, showShortcuts: false }));
    } else if (isDeleteDialogOpen) {
      setModalStates(prev => ({ ...prev, isDeleteDialogOpen: false }));
    } else if (errorMessage) {
      setErrorMessage(null);
    }
  };

  // Toggle handlers
  const toggleSessions = () => setModalStates(prev => ({ ...prev, isSessionsPanelOpen: !prev.isSessionsPanelOpen }));
  const toggleServers = () => setModalStates(prev => ({ ...prev, isServersPanelOpen: !prev.isServersPanelOpen }));

  return (
    <div className="flex h-screen bg-background">
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
              <MessageList messages={messages} />
            )}
            <InputArea 
              onSend={handleSend}
              disabled={isSendingMessage}
            />
          </div>
          
          <SlidingPanel isOpen={isSessionsPanelOpen} width="w-80">
            <SessionPanel
              isOpen={isSessionsPanelOpen}
              onClose={() => setModalStates(prev => ({ ...prev, isSessionsPanelOpen: false }))}
              currentSessionId={currentSessionId}
              onSessionChange={handleSessionChange}
              returnToWelcome={returnToWelcome || (() => {})}
              variant="inline"
            />
          </SlidingPanel>
          
          <SlidingPanel isOpen={isServersPanelOpen} width="w-80">
            <ServersPanel
              isOpen={isServersPanelOpen}
              onClose={() => setModalStates(prev => ({ ...prev, isServersPanelOpen: false }))}
            />
          </SlidingPanel>
        </div>

        <ErrorNotification 
          message={errorMessage}
          onDismiss={() => setErrorMessage(null)}
        />
      </main>
    </div>
  );
}