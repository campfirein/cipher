"use client"

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { useChat } from '@/hooks/use-chat';
import { 
  ChatContextType, 
  ChatProviderProps, 
  ChatMessage, 
  ConnectionStatus 
} from '@/types/chat';
import {
  getWebSocketUrl,
  createAutoSession,
  loadSession,
  loadSessionHistory,
  convertHistoryToUIMessages,
  resetBackendSession
} from '@/lib/chat-config';

// Create the context
const ChatContext = createContext<ChatContextType | null>(null);

export function ChatProvider({ 
  children, 
  wsUrl: customWsUrl,
  autoConnect = true 
}: ChatProviderProps) {
  // WebSocket URL configuration
  const wsUrl = getWebSocketUrl(customWsUrl);

  // State management
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [isWelcomeState, setIsWelcomeState] = useState(true);
  const [isStreaming, setIsStreaming] = useState(true);

  // Chat hook integration
  const {
    messages,
    sendMessage: originalSendMessage,
    status,
    reset: originalReset,
    setMessages,
    websocket,
    clearMessages
  } = useChat(wsUrl, {
    autoConnect,
    onMessage: (message) => {
      // Emit custom event for message
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('cipher:newMessage', {
            detail: { message, sessionId: currentSessionId }
          })
        );
      }
    },
    onError: (error) => {
      console.error('Chat WebSocket error:', error);
      // Emit custom event for error
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('cipher:error', {
            detail: { error, sessionId: currentSessionId }
          })
        );
      }
    },
    onStatusChange: (status) => {
      console.log('Chat WebSocket status changed:', status);
      // Emit custom event for status change
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('cipher:statusChange', {
            detail: { status, sessionId: currentSessionId }
          })
        );
      }
    }
  });

  // Enhanced send message with auto-session creation
  const sendMessage = useCallback(async (
    content: string,
    imageData?: { base64: string; mimeType: string }
  ) => {
    let sessionId = currentSessionId;

    // Auto-create session on first message
    if (!sessionId && isWelcomeState) {
      try {
        sessionId = await createAutoSession();

        // Load the new session as the current working session
        await loadSession(sessionId);

        setCurrentSessionId(sessionId);
        setIsWelcomeState(false);
      } catch (error) {
        console.error('Error creating auto session:', error);
        throw error;
      }
    }

    if (sessionId) {
      originalSendMessage(content, imageData, sessionId, isStreaming);
    } else {
      console.error('No session available for sending message');
      throw new Error('No session available for sending message');
    }
  }, [
    originalSendMessage, 
    currentSessionId, 
    isWelcomeState, 
    isStreaming
  ]);

  // Load session history
  const loadHistory = useCallback(async (sessionId: string) => {
    try {
      const history = await loadSessionHistory(sessionId);
      const uiMessages = convertHistoryToUIMessages(history, sessionId);
      setMessages(uiMessages);
    } catch (error) {
      console.error('Error loading session history:', error);
      // On error, just clear messages and continue
      setMessages([]);
    }
  }, [setMessages]);

  // Switch session
  const switchSession = useCallback(async (sessionId: string) => {
    if (sessionId === currentSessionId) return;

    try {
      // Load the session as the current working session on the backend
      await loadSession(sessionId);

      setCurrentSessionId(sessionId);
      setIsWelcomeState(false); // No longer in welcome state
      await loadHistory(sessionId);

      // Emit custom event for session switch
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('cipher:sessionChanged', {
            detail: { sessionId, previousSessionId: currentSessionId }
          })
        );
      }
    } catch (error) {
      console.error('Error switching session:', error);
      throw error; // Re-throw so UI can handle the error
    }
  }, [currentSessionId, loadHistory]);

  // Return to welcome state
  const returnToWelcome = useCallback(() => {
    const previousSessionId = currentSessionId;
    
    setCurrentSessionId(null);
    setIsWelcomeState(true);
    clearMessages();

    // Reset the backend to no default session
    resetBackendSession();

    // Emit custom event for returning to welcome
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('cipher:returnToWelcome', {
          detail: { previousSessionId }
        })
      );
    }
  }, [currentSessionId, clearMessages]);

  // Enhanced reset function
  const reset = useCallback(() => {
    if (currentSessionId) {
      originalReset(currentSessionId);
      
      // Emit custom event for conversation reset
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('cipher:conversationReset', {
            detail: { sessionId: currentSessionId }
          })
        );
      }
    }
  }, [originalReset, currentSessionId]);

  // Set streaming preference
  const setStreaming = useCallback((streaming: boolean) => {
    setIsStreaming(streaming);
    
    // Emit custom event for streaming preference change
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('cipher:streamingChanged', {
          detail: { streaming, sessionId: currentSessionId }
        })
      );
    }
  }, [currentSessionId]);

  // Event system integration
  useEffect(() => {
    const handleConfigChange = (event: CustomEvent) => {
      console.log('Config changed:', event.detail);
      // Trigger UI updates based on config changes
      // This could trigger a re-fetch of server configurations, etc.
    };

    const handleServersChange = (event: CustomEvent) => {
      console.log('Servers changed:', event.detail);
      // Trigger UI updates based on server changes
      // This could trigger a re-connect or server list refresh
    };

    const handleSessionReset = (event: CustomEvent) => {
      const { sessionId } = event.detail || {};
      if (sessionId === currentSessionId) {
        setMessages([]);
      }
    };

    const handleExternalSessionSwitch = (event: CustomEvent) => {
      const { sessionId } = event.detail || {};
      if (sessionId && sessionId !== currentSessionId) {
        switchSession(sessionId).catch(error => {
          console.error('Error handling external session switch:', error);
        });
      }
    };

    const handleWelcomeRequest = (event: CustomEvent) => {
      returnToWelcome();
    };

    if (typeof window !== 'undefined') {
      // Listen for configuration and server changes
      window.addEventListener('cipher:configChanged', handleConfigChange as EventListener);
      window.addEventListener('cipher:serversChanged', handleServersChange as EventListener);
      
      // Listen for session-related events from other components
      window.addEventListener('cipher:conversationReset', handleSessionReset as EventListener);
      window.addEventListener('cipher:switchSession', handleExternalSessionSwitch as EventListener);
      window.addEventListener('cipher:requestWelcome', handleWelcomeRequest as EventListener);

      return () => {
        window.removeEventListener('cipher:configChanged', handleConfigChange as EventListener);
        window.removeEventListener('cipher:serversChanged', handleServersChange as EventListener);
        window.removeEventListener('cipher:conversationReset', handleSessionReset as EventListener);
        window.removeEventListener('cipher:switchSession', handleExternalSessionSwitch as EventListener);
        window.removeEventListener('cipher:requestWelcome', handleWelcomeRequest as EventListener);
      };
    }
  }, [currentSessionId, setMessages, switchSession, returnToWelcome]);

  // Create session creation function for external use
  const createNewSession = useCallback(async (): Promise<string> => {
    try {
      const sessionId = await createAutoSession();
      await loadSession(sessionId);
      return sessionId;
    } catch (error) {
      console.error('Error creating new session:', error);
      throw error;
    }
  }, []);

  // Context value
  const contextValue: ChatContextType = {
    messages,
    sendMessage,
    status,
    reset,
    currentSessionId,
    switchSession,
    loadSessionHistory: loadHistory,
    isWelcomeState,
    returnToWelcome,
    isStreaming,
    setStreaming,
    websocket,
  };

  return (
    <ChatContext.Provider value={contextValue}>
      {children}
    </ChatContext.Provider>
  );
}

// Custom hook to use the chat context
export function useChatContext(): ChatContextType {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error('useChatContext must be used within a ChatProvider');
  }
  return context;
}

// Additional utility hooks
export function useChatSession() {
  const { currentSessionId, switchSession, returnToWelcome, isWelcomeState } = useChatContext();
  
  return {
    currentSessionId,
    switchSession,
    returnToWelcome,
    isWelcomeState,
    hasActiveSession: !isWelcomeState && currentSessionId !== null,
  };
}

export function useChatMessages() {
  const { messages, sendMessage, reset } = useChatContext();
  
  return {
    messages,
    sendMessage,
    reset,
    messageCount: messages.length,
    hasMessages: messages.length > 0,
  };
}

export function useChatStatus() {
  const { status, websocket, isStreaming, setStreaming } = useChatContext();
  
  return {
    status,
    websocket,
    isStreaming,
    setStreaming,
    isConnected: status === 'open',
    isConnecting: status === 'connecting',
    isDisconnected: status === 'closed',
  };
}